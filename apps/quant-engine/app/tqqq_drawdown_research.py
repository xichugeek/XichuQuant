from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import date
from itertools import product
from typing import Any, Literal, cast
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

from app.volatility_overlay_research import (
    IBKR_PRO_FIRST_TIER_SPREAD_PERCENT,
    TRADING_SLIPPAGE_RATE,
    _commission,
    _daily_margin_interest,
    load_fred_dff,
    load_local_market_data,
)

FundingMode = Literal["REPLACE_QQQ", "BORROWED_OVERLAY"]
ENTRY_DRAWDOWN_GRID = (-0.15, -0.20, -0.25, -0.30, -0.35)
TQQQ_WEIGHT_GRID = (0.01, 0.025, 0.05)


@dataclass(frozen=True)
class DrawdownRule:
    entry_drawdown: float
    tqqq_weight: float
    funding_mode: FundingMode

    def __post_init__(self) -> None:
        if self.entry_drawdown not in ENTRY_DRAWDOWN_GRID:
            raise ValueError("entry_drawdown 不在预先声明的研究网格")
        if self.tqqq_weight not in TQQQ_WEIGHT_GRID:
            raise ValueError("tqqq_weight 不在预先声明的研究网格")
        if self.tqqq_weight > 0.05:
            raise ValueError("TQQQ 仓位不能突破系统现有单只杠杆 ETF 5% 上限")

    @property
    def exit_drawdown(self) -> float:
        return self.entry_drawdown / 2


def drawdown_states(qqq_close: pd.Series, rule: DrawdownRule) -> pd.Series:
    """Create close-known states with hysteresis; a changed close cannot alter prior states."""

    close = qqq_close.astype("float64").sort_index()
    drawdown = close / close.cummax() - 1
    active = False
    states: list[bool] = []
    for value in drawdown:
        observed = float(value)
        if not active and observed <= rule.entry_drawdown:
            active = True
        elif active and observed >= rule.exit_drawdown:
            active = False
        states.append(active)
    return pd.Series(states, index=close.index, dtype="bool")


def _target_weights(active: bool, rule: DrawdownRule) -> dict[str, float]:
    if not active:
        return {"QQQ": 1.0, "TQQQ": 0.0}
    if rule.funding_mode == "REPLACE_QQQ":
        return {"QQQ": 1 - rule.tqqq_weight, "TQQQ": rule.tqqq_weight}
    return {"QQQ": 1.0, "TQQQ": rule.tqqq_weight}


def _affordable_quantity(cash: float, execution_price: float) -> int:
    quantity = max(0, math.floor(cash / execution_price))
    while quantity > 0:
        notional = quantity * execution_price
        if notional + _commission(quantity, notional) <= cash:
            return quantity
        quantity -= 1
    return 0


def _metrics(
    equity: pd.Series,
    exposure: pd.Series,
    tqqq_weight: pd.Series,
    initial_capital: float,
    total_commission: float,
    total_slippage: float,
    total_financing: float,
    executions: int,
) -> dict[str, float | int]:
    daily_returns = equity.pct_change().dropna()
    elapsed_years = (equity.index[-1] - equity.index[0]).days / 365.25
    total_return = equity.iloc[-1] / initial_capital - 1
    cagr = (equity.iloc[-1] / initial_capital) ** (1 / elapsed_years) - 1
    drawdown = equity / equity.cummax() - 1
    standard_deviation = float(daily_returns.std(ddof=1))
    sharpe = (
        float(daily_returns.mean() / standard_deviation * math.sqrt(252))
        if standard_deviation > 0
        else 0.0
    )
    return {
        "finalEquity": round(float(equity.iloc[-1]), 2),
        "totalReturn": round(float(total_return * 100), 6),
        "cagr": round(float(cagr * 100), 6),
        "maxDrawdown": round(float(drawdown.min() * 100), 6),
        "sharpeRatio": round(sharpe, 6),
        "averageNasdaqExposure": round(float(exposure.mean() * 100), 6),
        "maximumNasdaqExposure": round(float(exposure.max() * 100), 6),
        "maximumTqqqWeight": round(float(tqqq_weight.max() * 100), 6),
        "totalCommission": round(total_commission, 4),
        "totalSlippage": round(total_slippage, 4),
        "totalFinancing": round(total_financing, 4),
        "executionCount": executions,
    }


def simulate_drawdown_rule(
    market: pd.DataFrame,
    benchmark_rates_percent: pd.Series,
    evaluation_start: date,
    evaluation_end: date,
    rule: DrawdownRule,
    *,
    initial_capital: float = 100_000,
    force_active: bool | None = None,
) -> dict[str, float | int]:
    frame = market.sort_index().copy()
    states = drawdown_states(frame["qqqClose"], rule)
    frame_index = cast(pd.DatetimeIndex, frame.index)
    evaluation = frame.loc[
        (frame_index.date >= evaluation_start) & (frame_index.date <= evaluation_end)
    ]
    if len(evaluation) < 2:
        raise ValueError("评估区间共同行情不足")

    cash = initial_capital
    quantities = {"QQQ": 0, "TQQQ": 0}
    total_commission = 0.0
    total_slippage = 0.0
    total_financing = 0.0
    executions = 0
    previous_date: date | None = None
    applied_state: bool | None = None
    equity_values: list[float] = []
    exposure_values: list[float] = []
    tqqq_weight_values: list[float] = []
    dates: list[pd.Timestamp] = []

    for local_index, (timestamp_value, row) in enumerate(evaluation.iterrows()):
        timestamp = pd.Timestamp(cast(Any, timestamp_value))
        current_date = timestamp.date()
        if previous_date is not None and cash < 0:
            interest = _daily_margin_interest(
                -cash,
                previous_date,
                current_date,
                benchmark_rates_percent,
                IBKR_PRO_FIRST_TIER_SPREAD_PERCENT,
            )
            cash -= interest
            total_financing += interest

        signal_index = max(0, local_index - 1)
        evaluation_index = cast(pd.DatetimeIndex, evaluation.index)
        signal_date = pd.Timestamp(evaluation_index[signal_index])
        signaled_state = force_active if force_active is not None else bool(states.loc[signal_date])
        risk_rebalance = False
        if local_index > 1 and quantities["TQQQ"] > 0:
            previous_row = evaluation.iloc[local_index - 1]
            previous_tqqq_value = quantities["TQQQ"] * float(previous_row["tqqqClose"])
            previous_equity = cash + quantities["QQQ"] * float(
                previous_row["qqqClose"]
            ) + previous_tqqq_value
            risk_rebalance = (
                previous_equity > 0
                and previous_tqqq_value / previous_equity > rule.tqqq_weight
            )
        should_rebalance = local_index == 1 or (
            local_index > 1 and signaled_state != applied_state
        ) or risk_rebalance
        if should_rebalance:
            opens = {"QQQ": float(row["qqqOpen"]), "TQQQ": float(row["tqqqOpen"])}
            equity_at_open = cash + sum(
                quantities[symbol] * opens[symbol] for symbol in quantities
            )
            if equity_at_open <= 0:
                raise ValueError("融资后权益已归零，研究路径失效")
            weights = _target_weights(signaled_state, rule)
            desired = {
                symbol: math.floor(equity_at_open * weight / opens[symbol])
                for symbol, weight in weights.items()
            }

            for symbol in ("TQQQ", "QQQ"):
                delta = desired[symbol] - quantities[symbol]
                if delta >= 0:
                    continue
                traded = -delta
                execution_price = opens[symbol] * (1 - TRADING_SLIPPAGE_RATE)
                notional = traded * execution_price
                commission = _commission(traded, notional)
                cash += notional - commission
                quantities[symbol] -= traded
                total_commission += commission
                total_slippage += traded * opens[symbol] * TRADING_SLIPPAGE_RATE
                executions += 1

            for symbol in ("TQQQ", "QQQ"):
                delta = desired[symbol] - quantities[symbol]
                if delta <= 0:
                    continue
                execution_price = opens[symbol] * (1 + TRADING_SLIPPAGE_RATE)
                if rule.funding_mode == "REPLACE_QQQ":
                    delta = min(delta, _affordable_quantity(cash, execution_price))
                if delta <= 0:
                    continue
                notional = delta * execution_price
                commission = _commission(delta, notional)
                cash -= notional + commission
                quantities[symbol] += delta
                total_commission += commission
                total_slippage += delta * opens[symbol] * TRADING_SLIPPAGE_RATE
                executions += 1
            applied_state = signaled_state

        qqq_value = quantities["QQQ"] * float(row["qqqClose"])
        tqqq_value = quantities["TQQQ"] * float(row["tqqqClose"])
        equity = cash + qqq_value + tqqq_value
        if equity <= 0:
            raise ValueError("收盘权益已归零，研究路径失效")
        # TQQQ targets 3x daily Nasdaq-100 exposure; this is an exposure proxy,
        # not an assertion that multi-day TQQQ returns equal three times QQQ.
        nasdaq_exposure = (qqq_value + 3 * tqqq_value) / equity
        dates.append(timestamp)
        equity_values.append(equity)
        exposure_values.append(nasdaq_exposure)
        tqqq_weight_values.append(tqqq_value / equity)
        previous_date = current_date

    equity_series = pd.Series(equity_values, index=pd.DatetimeIndex(dates), dtype="float64")
    exposure_series = pd.Series(
        exposure_values, index=pd.DatetimeIndex(dates), dtype="float64"
    )
    tqqq_weight_series = pd.Series(
        tqqq_weight_values, index=pd.DatetimeIndex(dates), dtype="float64"
    )
    return _metrics(
        equity_series,
        exposure_series,
        tqqq_weight_series,
        initial_capital,
        total_commission,
        total_slippage,
        total_financing,
        executions,
    )


def select_on_development(
    market: pd.DataFrame,
    rates: pd.Series,
    start: date,
    end: date,
    funding_mode: FundingMode,
) -> tuple[DrawdownRule, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    for entry, weight in product(ENTRY_DRAWDOWN_GRID, TQQQ_WEIGHT_GRID):
        rule = DrawdownRule(entry, weight, funding_mode)
        metrics = simulate_drawdown_rule(market, rates, start, end, rule)
        candidates.append({"rule": rule, "metrics": metrics})
    candidates.sort(
        key=lambda item: (
            float(item["metrics"]["totalReturn"]),
            float(item["metrics"]["maxDrawdown"]),
        ),
        reverse=True,
    )
    return candidates[0]["rule"], candidates


def compare_research_candidates(
    market: pd.DataFrame,
    rates: pd.Series,
    periods: dict[str, tuple[date, date]],
) -> dict[str, Any]:
    development = periods["development"]
    output: dict[str, Any] = {
        "data": {
            "firstCommonDate": market.index[0].date().isoformat(),
            "lastCommonDate": market.index[-1].date().isoformat(),
            "note": "仅使用 TQQQ 上市后的真实产品行情，不合成上市前历史。",
        },
        "method": {
            "entryGridDrawdownPercent": [value * 100 for value in ENTRY_DRAWDOWN_GRID],
            "tqqqWeightGridPercent": [value * 100 for value in TQQQ_WEIGHT_GRID],
            "exit": "QQQ 回撤恢复至入场回撤阈值的一半",
            "execution": "收盘确认状态，下一共同交易日开盘执行",
            "candidateCountPerFundingMode": len(ENTRY_DRAWDOWN_GRID) * len(TQQQ_WEIGHT_GRID),
            "selection": "只按 development 总收益选择一次，validation 和 heldOut 不再调参",
        },
        "modes": {},
    }
    for mode in ("REPLACE_QQQ", "BORROWED_OVERLAY"):
        selected, candidates = select_on_development(
            market, rates, development[0], development[1], mode
        )
        mode_output: dict[str, Any] = {
            "selected": {
                "entryDrawdownPercent": selected.entry_drawdown * 100,
                "exitDrawdownPercent": selected.exit_drawdown * 100,
                "tqqqWeightPercent": selected.tqqq_weight * 100,
            },
            "developmentCandidateCount": len(candidates),
            "periods": {},
        }
        sensitivity = {
            "validationReturnWinners": 0,
            "heldOutReturnWinners": 0,
            "bothOutOfSampleReturnWinners": 0,
            "bothOutOfSampleReturnAndDrawdownWinners": 0,
        }
        benchmark_rule = DrawdownRule(-0.15, selected.tqqq_weight, "REPLACE_QQQ")
        validation_start, validation_end = periods["validation"]
        held_out_start, held_out_end = periods["heldOut"]
        validation_benchmark = simulate_drawdown_rule(
            market,
            rates,
            validation_start,
            validation_end,
            benchmark_rule,
            force_active=False,
        )
        held_out_benchmark = simulate_drawdown_rule(
            market,
            rates,
            held_out_start,
            held_out_end,
            benchmark_rule,
            force_active=False,
        )
        for candidate in candidates:
            candidate_rule = candidate["rule"]
            validation_metrics = simulate_drawdown_rule(
                market, rates, validation_start, validation_end, candidate_rule
            )
            held_out_metrics = simulate_drawdown_rule(
                market, rates, held_out_start, held_out_end, candidate_rule
            )
            validation_wins = float(validation_metrics["totalReturn"]) > float(
                validation_benchmark["totalReturn"]
            )
            held_out_wins = float(held_out_metrics["totalReturn"]) > float(
                held_out_benchmark["totalReturn"]
            )
            sensitivity["validationReturnWinners"] += int(validation_wins)
            sensitivity["heldOutReturnWinners"] += int(held_out_wins)
            sensitivity["bothOutOfSampleReturnWinners"] += int(
                validation_wins and held_out_wins
            )
            protects_drawdown = float(validation_metrics["maxDrawdown"]) >= float(
                validation_benchmark["maxDrawdown"]
            ) and float(held_out_metrics["maxDrawdown"]) >= float(
                held_out_benchmark["maxDrawdown"]
            )
            sensitivity["bothOutOfSampleReturnAndDrawdownWinners"] += int(
                validation_wins and held_out_wins and protects_drawdown
            )
        mode_output["sensitivity"] = sensitivity
        for label, (start, end) in periods.items():
            strategy = simulate_drawdown_rule(market, rates, start, end, selected)
            buy_hold = simulate_drawdown_rule(
                market, rates, start, end, benchmark_rule, force_active=False
            )
            constant = simulate_drawdown_rule(
                market, rates, start, end, selected, force_active=True
            )
            mode_output["periods"][label] = {
                "qqqBuyHold100": buy_hold,
                "drawdownTqqq": strategy,
                "constantTqqqSameWeight": constant,
            }
        output["modes"][mode] = mode_output
    return output


def load_yahoo_adjusted(symbol: str, start: date, end: date) -> pd.DataFrame:
    period1 = int(pd.Timestamp(start, tz="UTC").timestamp())
    period2 = int((pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)).timestamp())
    query = urlencode(
        {
            "period1": period1,
            "period2": period2,
            "interval": "1d",
            "events": "div,splits",
            "includeAdjustedClose": "true",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{query}"
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed Yahoo chart endpoint
        payload = json.loads(response.read().decode("utf-8"))
    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    adjusted = result["indicators"]["adjclose"][0]["adjclose"]
    records: list[dict[str, Any]] = []
    for timestamp, open_price, close_price, adjusted_close in zip(
        result["timestamp"], quote["open"], quote["close"], adjusted, strict=True
    ):
        if open_price is None or close_price is None or adjusted_close is None:
            continue
        factor = float(adjusted_close) / float(close_price)
        records.append(
            {
                "tradeDate": pd.Timestamp(timestamp, unit="s", tz="UTC")
                .tz_localize(None)
                .normalize(),
                "adjustedOpen": float(open_price) * factor,
                "adjustedClose": float(adjusted_close),
            }
        )
    if not records:
        raise ValueError(f"{symbol} 外部行情为空")
    return pd.DataFrame(records).drop_duplicates("tradeDate").set_index("tradeDate").sort_index()


def combined_market(api_base: str, source: str) -> pd.DataFrame:
    qqq = load_local_market_data(api_base, "QQQ", source).rename(
        columns={"adjustedOpen": "qqqOpen", "adjustedClose": "qqqClose"}
    )
    tqqq = load_yahoo_adjusted("TQQQ", date(2010, 2, 9), date(2026, 12, 31)).rename(
        columns={"adjustedOpen": "tqqqOpen", "adjustedClose": "tqqqClose"}
    )
    return qqq[["qqqOpen", "qqqClose"]].join(
        tqqq[["tqqqOpen", "tqqqClose"]], how="inner"
    ).dropna()


def main() -> None:
    parser = argparse.ArgumentParser(description="QQQ 暴跌阶段 TQQQ 卫星仓位研究")
    parser.add_argument("--api-base", default="http://localhost:5089")
    parser.add_argument("--source", default="CSV_IMPORT")
    args = parser.parse_args()
    market = combined_market(args.api_base, args.source)
    rates = load_fred_dff("2009-01-01", "2026-12-31")
    periods = {
        "development": (date(2010, 2, 11), date(2018, 12, 31)),
        "validation": (date(2019, 1, 2), date(2022, 12, 30)),
        "heldOut": (date(2023, 1, 3), date(2026, 8, 21)),
        "full": (date(2010, 2, 11), date(2026, 8, 21)),
    }
    print(
        json.dumps(
            compare_research_candidates(market, rates, periods),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
