from __future__ import annotations

import argparse
import csv
import io
import json
import math
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median
from typing import Any, cast
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd

IBKR_COMMISSION_PER_SHARE = 0.0035
IBKR_MINIMUM_COMMISSION = 0.35
IBKR_MAXIMUM_COMMISSION_RATE = 0.01
IBKR_PRO_FIRST_TIER_SPREAD_PERCENT = 1.5
TRADING_SLIPPAGE_RATE = 0.0005


@dataclass(frozen=True)
class OverlayPolicy:
    """Pre-declared research policy; it is not an order-generating strategy."""

    minimum_exposure: float = 1.0
    maximum_exposure: float = 1.1
    minimum_history_months: int = 12

    def __post_init__(self) -> None:
        if not 0 < self.minimum_exposure <= self.maximum_exposure:
            raise ValueError("minimum_exposure 必须为正且不能高于 maximum_exposure")
        if self.maximum_exposure > 1.1:
            raise ValueError("研究覆盖层不得突破系统现有 10% 杠杆策略上限")
        if self.minimum_history_months < 12:
            raise ValueError("至少需要 12 个完整历史月份，避免短样本波动率标尺")


@dataclass
class SimulationResult:
    metrics: dict[str, float | int]
    equity: pd.Series
    exposure: pd.Series


def monthly_inverse_variance_targets(
    closes: pd.Series, policy: OverlayPolicy | None = None
) -> pd.Series:
    """Form next-month exposure from completed daily returns only.

    The scale is the expanding median of all completed monthly return variances.
    No full-sample normalization or future observation is used.
    """

    policy = policy or OverlayPolicy()
    closes = cast(pd.Series, closes.astype("float64").sort_index())
    returns = closes.pct_change().dropna()
    return_index = cast(pd.DatetimeIndex, returns.index)
    monthly_variance = cast(
        pd.Series, returns.groupby(return_index.to_period("M")).var(ddof=1).dropna()
    )
    close_index = cast(pd.DatetimeIndex, closes.index)
    targets: dict[pd.Timestamp, float] = {}
    history: list[float] = []
    for month_value, variance_value in monthly_variance.items():
        month = cast(pd.Period, month_value)
        variance = float(variance_value)
        if not math.isfinite(variance) or variance <= 0:
            continue
        history.append(variance)
        if len(history) < policy.minimum_history_months:
            target = policy.minimum_exposure
        else:
            scale = median(history) / variance
            target = min(policy.maximum_exposure, max(policy.minimum_exposure, scale))
        month_dates = close_index[close_index.to_period("M") == month]
        if len(month_dates) > 0:
            targets[pd.Timestamp(month_dates[-1])] = target
    return pd.Series(targets, dtype="float64").sort_index()


def _commission(quantity: int, notional: float) -> float:
    if quantity <= 0:
        return 0.0
    uncapped = max(IBKR_MINIMUM_COMMISSION, quantity * IBKR_COMMISSION_PER_SHARE)
    return min(uncapped, notional * IBKR_MAXIMUM_COMMISSION_RATE)


def _daily_margin_interest(
    borrowed_cash: float,
    start: date,
    end: date,
    benchmark_rates_percent: pd.Series,
    spread_percent: float,
) -> float:
    if borrowed_cash <= 0 or end <= start:
        return 0.0
    total = 0.0
    cursor = start
    rates = benchmark_rates_percent.sort_index()
    while cursor < end:
        observed: Any = rates.asof(pd.Timestamp(cursor))
        benchmark = float(observed) if not pd.isna(observed) else 0.0
        annual_rate = (max(benchmark, 0.0) + spread_percent) / 100
        daily = borrowed_cash * annual_rate / 360
        total += daily
        borrowed_cash += daily
        cursor += timedelta(days=1)
    return total


def simulate_exposure_policy(
    market: pd.DataFrame,
    benchmark_rates_percent: pd.Series,
    evaluation_start: date,
    evaluation_end: date,
    initial_capital: float,
    target_by_signal_date: pd.Series | None,
    *,
    fixed_exposure: float | None = None,
    monthly_rebalance: bool = True,
    margin_spread_percent: float = IBKR_PRO_FIRST_TIER_SPREAD_PERCENT,
) -> SimulationResult:
    if (target_by_signal_date is None) == (fixed_exposure is None):
        raise ValueError("动态目标和固定敞口必须且只能指定一个")
    frame = market.sort_index().copy()
    frame_index = cast(pd.DatetimeIndex, frame.index)
    evaluation = frame.loc[
        (frame_index.date >= evaluation_start) & (frame_index.date <= evaluation_end)
    ]
    if len(evaluation) < 2:
        raise ValueError("评估区间行情不足")

    if fixed_exposure is not None and not 0 < fixed_exposure <= 1.1:
        raise ValueError("固定敞口必须位于 0 到 110% 之间")

    target_by_signal_date = (
        target_by_signal_date.sort_index() if target_by_signal_date is not None else None
    )
    cash = initial_capital
    quantity = 0
    total_commission = 0.0
    total_slippage = 0.0
    total_financing = 0.0
    executions = 0
    equity_values: list[float] = []
    exposure_values: list[float] = []
    dates: list[pd.Timestamp] = []
    previous_date: date | None = None

    evaluation_index = cast(pd.DatetimeIndex, evaluation.index)
    execution_dates: set[pd.Timestamp] = {pd.Timestamp(evaluation_index[1])}
    if monthly_rebalance:
        periods = evaluation_index.to_period("M")
        for index in range(1, len(evaluation)):
            if periods[index] != periods[index - 1]:
                execution_dates.add(pd.Timestamp(evaluation_index[index]))

    for local_index, (timestamp_value, row) in enumerate(evaluation.iterrows()):
        timestamp = pd.Timestamp(cast(Any, timestamp_value))
        current_date = timestamp.date()
        if previous_date is not None and cash < 0:
            interest = _daily_margin_interest(
                -cash,
                previous_date,
                current_date,
                benchmark_rates_percent,
                margin_spread_percent,
            )
            cash -= interest
            total_financing += interest

        raw_open = float(row["adjustedOpen"])
        close = float(row["adjustedClose"])
        should_rebalance = timestamp in execution_dates
        if fixed_exposure == 1.0 and local_index > 1:
            should_rebalance = False
        if exposure_values and exposure_values[-1] > 1.1:
            # A falling market or accrued interest can lift gross exposure above the target
            # between scheduled rebalances.  Use the prior close only and correct next open.
            should_rebalance = True
        if should_rebalance:
            equity_at_open = cash + quantity * raw_open
            if equity_at_open <= 0:
                raise ValueError("融资后权益已归零，研究路径失效")
            if fixed_exposure is not None:
                target = fixed_exposure
            else:
                assert target_by_signal_date is not None
                known = target_by_signal_date.loc[target_by_signal_date.index < timestamp]
                target = float(known.iloc[-1]) if not known.empty else 1.0
            desired = math.floor(equity_at_open * target / raw_open)
            delta = desired - quantity
            while delta > 0:
                provisional_price = raw_open * (1 + TRADING_SLIPPAGE_RATE)
                provisional_notional = delta * provisional_price
                provisional_commission = _commission(delta, provisional_notional)
                post_trade_equity = (
                    equity_at_open
                    - delta * raw_open * TRADING_SLIPPAGE_RATE
                    - provisional_commission
                )
                if post_trade_equity > 0 and desired * raw_open / post_trade_equity <= target:
                    break
                desired -= 1
                delta -= 1
            if delta != 0:
                execution_price = raw_open * (
                    1 + TRADING_SLIPPAGE_RATE if delta > 0 else 1 - TRADING_SLIPPAGE_RATE
                )
                traded = abs(delta)
                notional = traded * execution_price
                commission = _commission(traded, notional)
                if delta > 0:
                    cash -= notional + commission
                else:
                    cash += notional - commission
                quantity = desired
                total_commission += commission
                total_slippage += traded * raw_open * TRADING_SLIPPAGE_RATE
                executions += 1

        equity = cash + quantity * close
        if equity <= 0:
            raise ValueError("收盘权益已归零，研究路径失效")
        position_value = quantity * close
        dates.append(timestamp)
        equity_values.append(equity)
        exposure_values.append(position_value / equity)
        previous_date = current_date

    equity_series = pd.Series(equity_values, index=pd.DatetimeIndex(dates), dtype="float64")
    exposure_series = pd.Series(
        exposure_values, index=pd.DatetimeIndex(dates), dtype="float64"
    )
    daily_returns = equity_series.pct_change().dropna()
    elapsed_years = (equity_series.index[-1] - equity_series.index[0]).days / 365.25
    total_return = equity_series.iloc[-1] / initial_capital - 1
    cagr = (equity_series.iloc[-1] / initial_capital) ** (1 / elapsed_years) - 1
    drawdown = equity_series / equity_series.cummax() - 1
    volatility = float(daily_returns.std(ddof=1) * math.sqrt(252))
    sharpe = (
        float(daily_returns.mean() / daily_returns.std(ddof=1) * math.sqrt(252))
        if float(daily_returns.std(ddof=1)) > 0
        else 0.0
    )
    metrics: dict[str, float | int] = {
        "finalEquity": round(float(equity_series.iloc[-1]), 2),
        "totalReturn": round(float(total_return * 100), 6),
        "cagr": round(float(cagr * 100), 6),
        "maxDrawdown": round(float(drawdown.min() * 100), 6),
        "annualizedVolatility": round(volatility * 100, 6),
        "sharpeRatio": round(sharpe, 6),
        "averageExposure": round(float(exposure_series.mean() * 100), 6),
        "maximumObservedExposure": round(float(exposure_series.max() * 100), 6),
        "totalCommission": round(total_commission, 4),
        "totalSlippage": round(total_slippage, 4),
        "totalFinancing": round(total_financing, 4),
        "executionCount": executions,
    }
    return SimulationResult(metrics=metrics, equity=equity_series, exposure=exposure_series)


def compare_policies(
    market: pd.DataFrame,
    benchmark_rates_percent: pd.Series,
    periods: dict[str, tuple[date, date]],
    initial_capital: float = 100_000,
) -> dict[str, Any]:
    policy = OverlayPolicy()
    targets = monthly_inverse_variance_targets(market["adjustedClose"], policy)
    output: dict[str, Any] = {
        "method": {
            "signal": "上月日收益方差 / 截至当时的扩展月方差中位数",
            "execution": "月末收盘形成目标，下一交易日开盘执行",
            "exposureRangePercent": [100, 110],
            "financing": "FRED DFF（不低于零）+ IBKR Pro 首档 1.5%，按实际日历日/360 计提",
            "commission": "IBKR Pro 美国股票阶梯基础佣金代理",
            "slippagePercentEachSide": TRADING_SLIPPAGE_RATE * 100,
        },
        "periods": {},
    }
    for label, (start, end) in periods.items():
        overlay = simulate_exposure_policy(
            market,
            benchmark_rates_percent,
            start,
            end,
            initial_capital,
            targets,
        )
        buy_hold = simulate_exposure_policy(
            market,
            benchmark_rates_percent,
            start,
            end,
            initial_capital,
            None,
            fixed_exposure=1.0,
            monthly_rebalance=False,
        )
        constant_cap = simulate_exposure_policy(
            market,
            benchmark_rates_percent,
            start,
            end,
            initial_capital,
            None,
            fixed_exposure=1.1,
        )
        average_target = float(overlay.exposure.mean())
        average_target = min(1.1, max(1.0, average_target))
        equal_average = simulate_exposure_policy(
            market,
            benchmark_rates_percent,
            start,
            end,
            initial_capital,
            None,
            fixed_exposure=average_target,
        )
        output["periods"][label] = {
            "buyHold100": buy_hold.metrics,
            "volatilityOverlay": overlay.metrics,
            "constant110": constant_cap.metrics,
            "constantEqualAverageExposure": equal_average.metrics,
        }
    return output


def _fetch_json(url: str) -> Any:
    with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed local/official endpoints
        return json.loads(response.read().decode("utf-8"))


def load_local_market_data(api_base: str, symbol: str, source: str) -> pd.DataFrame:
    ranges = [("2005-01-01", "2015-12-31"), ("2016-01-01", "2026-12-31")]
    rows: list[dict[str, Any]] = []
    for start, end in ranges:
        query = urlencode(
            {"symbol": symbol, "source": source, "startDate": start, "endDate": end}
        )
        payload = _fetch_json(f"{api_base.rstrip('/')}/market-data/daily?{query}")
        if not isinstance(payload, list):
            raise ValueError("本地行情 API 返回格式无效")
        rows.extend(payload)
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise ValueError("本地行情 API 没有返回数据")
    frame["tradeDate"] = pd.to_datetime(frame["tradeDate"])
    factor = frame["adjustedClose"].astype("float64") / frame["close"].astype("float64")
    frame["adjustedOpen"] = frame["open"].astype("float64") * factor
    frame["adjustedClose"] = frame["adjustedClose"].astype("float64")
    return frame.drop_duplicates("tradeDate").set_index("tradeDate").sort_index()


def load_fred_dff(start: str, end: str) -> pd.Series:
    query = urlencode({"id": "DFF", "cosd": start, "coed": end})
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?{query}"
    with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed official FRED endpoint
        content = response.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(content)))
    values: dict[pd.Timestamp, float] = {}
    for row in rows:
        value = row.get("DFF", ".")
        observed = row.get("observation_date") or row.get("DATE")
        if not observed or value in {None, ".", ""}:
            continue
        values[pd.Timestamp(observed)] = float(value)
    if not values:
        raise ValueError("FRED DFF 没有返回可用数据")
    return pd.Series(values, dtype="float64").sort_index()


def main() -> None:
    parser = argparse.ArgumentParser(description="QQQ 受控波动率杠杆覆盖层研究")
    parser.add_argument("--api-base", default="http://localhost:5089")
    parser.add_argument("--symbol", default="QQQ")
    parser.add_argument("--source", default="CSV_IMPORT")
    args = parser.parse_args()
    market = load_local_market_data(args.api_base, args.symbol, args.source)
    rates = load_fred_dff("2005-01-01", "2026-12-31")
    periods = {
        "full": (date(2006, 8, 21), date(2026, 8, 21)),
        "development": (date(2006, 8, 21), date(2016, 12, 30)),
        "validation": (date(2017, 1, 3), date(2022, 12, 30)),
        "heldOut": (date(2023, 1, 3), date(2026, 8, 21)),
    }
    print(json.dumps(compare_policies(market, rates, periods), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
