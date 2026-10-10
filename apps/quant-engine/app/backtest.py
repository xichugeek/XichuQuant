from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

import numpy as np
import pandas as pd

from app.indicators import rsi, sma
from app.models import (
    BacktestRequest,
    FundamentalLiquidityCrowdingParameters,
    MovingAverageCrossParameters,
    RsiMeanReversionParameters,
    TimeSeriesMomentumParameters,
    validate_strategy_parameters,
)

REQUIRED_EVIDENCE_METRICS = (
    "FUNDAMENTAL_GROWTH_SCORE",
    "ORDER_BOOK_IMBALANCE",
    "FINANCIAL_CONDITIONS_Z",
    "SHORT_INTEREST_PERCENT",
    "DAYS_TO_COVER",
)


@dataclass
class Portfolio:
    cash: float
    quantity: float = 0
    avg_cost: float = 0
    entry_date: date | None = None

    def buy(self, quantity: float, price: float, commission: float, trade_date: date) -> None:
        total_cost = quantity * price + commission
        if quantity <= 0 or total_cost > self.cash + 1e-8:
            raise ValueError("现金不足，买入被拒绝")
        old_cost = self.quantity * self.avg_cost
        self.quantity += quantity
        self.cash -= total_cost
        self.avg_cost = (old_cost + total_cost) / self.quantity
        if self.entry_date is None:
            self.entry_date = trade_date

    def sell(self, quantity: float, price: float, commission: float) -> float:
        if quantity <= 0 or quantity > self.quantity + 1e-8:
            raise ValueError("卖出数量超过持仓")
        cost_basis = quantity * self.avg_cost
        proceeds = quantity * price - commission
        self.cash += proceeds
        self.quantity -= quantity
        realized_pnl = proceeds - cost_basis
        if self.quantity <= 1e-8:
            self.quantity = 0
            self.avg_cost = 0
            self.entry_date = None
        return realized_pnl


def _frame(request: BacktestRequest) -> pd.DataFrame:
    records = [bar.model_dump() for bar in sorted(request.bars, key=lambda item: item.tradeDate)]
    frame = pd.DataFrame(records)
    frame["tradeDate"] = pd.to_datetime(frame["tradeDate"])
    for column in ["open", "high", "low", "close", "adjustedClose", "dividend", "splitFactor"]:
        frame[column] = frame[column].astype("float64")
    if request.priceMode == "ADJUSTED":
        factor = frame["adjustedClose"] / frame["close"]
        for column in ["open", "high", "low", "close"]:
            frame[f"backtest_{column}"] = frame[column] * factor
    else:
        for column in ["open", "high", "low", "close"]:
            frame[f"backtest_{column}"] = frame[column]
    return frame


def _commission(request: BacktestRequest, quantity: float, notional: float) -> float:
    if request.commissionModel == "IBKR_US_EQUITY_TIERED_BASE":
        uncapped = max(request.minimumCommissionPerOrder, quantity * request.commissionPerShare)
        return min(uncapped, notional * request.maximumCommissionRate)
    return notional * request.commissionRate


def _affordable_quantity(
    request: BacktestRequest, allocation: float, execution_price: float
) -> int:
    if request.commissionModel == "PERCENT_NOTIONAL":
        return math.floor(allocation / (execution_price * (1 + request.commissionRate)))
    quantity = math.floor(allocation / execution_price)
    while quantity > 0:
        notional = quantity * execution_price
        if notional + _commission(request, quantity, notional) <= allocation:
            return quantity
        quantity -= 1
    return 0


def three_layer_state(
    frame: pd.DataFrame,
    evidence: list[Any],
    params: FundamentalLiquidityCrowdingParameters,
) -> pd.DataFrame:
    close = frame["backtest_close"] if "backtest_close" in frame else frame["close"]
    trend = sma(close, params.trendPeriod)
    trend_is_up = (close > trend) & (trend > trend.shift(params.trendSlopeLookback))
    dollar_volume = close * frame["volume"].astype("float64")
    typical_dollar_volume = dollar_volume.rolling(
        params.liquidityPeriod, min_periods=params.liquidityPeriod
    ).median()
    dollar_volume_ratio = dollar_volume / typical_dollar_volume.replace(0, np.nan)
    amihud = close.pct_change().abs() / dollar_volume.replace(0, np.nan)
    typical_amihud = (
        amihud.shift(1).rolling(params.liquidityPeriod, min_periods=params.liquidityPeriod).median()
    )
    illiquidity_multiple = amihud / typical_amihud.replace(0, np.nan)
    proxy_liquidity_stress = (dollar_volume_ratio < params.minimumDollarVolumeRatio) | (
        illiquidity_multiple > params.maximumIlliquidityMultiple
    )
    crowding_mean = close.rolling(params.crowdingPeriod, min_periods=params.crowdingPeriod).mean()
    crowding_std = close.rolling(params.crowdingPeriod, min_periods=params.crowdingPeriod).std(
        ddof=1
    )
    crowding_z_score = (close - crowding_mean) / crowding_std.replace(0, np.nan)
    proxy_crowding_stress = (crowding_z_score.abs() > params.maximumCrowdingZScore) & (
        dollar_volume_ratio > params.crowdingVolumeMultiple
    )

    state = pd.DataFrame(index=frame.index)
    state["trendIsUp"] = trend_is_up.fillna(False)
    state["proxyLiquidityStress"] = proxy_liquidity_stress.fillna(False)
    state["proxyCrowdingStress"] = proxy_crowding_stress.fillna(False)
    trade_dates = (
        pd.to_datetime(frame["tradeDate"], utc=True).dt.normalize().astype("datetime64[ns, UTC]")
    )
    symbol = str(frame.iloc[0]["symbol"])
    for metric in REQUIRED_EVIDENCE_METRICS:
        rows = [
            item
            for item in evidence
            if item.metricCode == metric
            and item.verificationStatus == "VERIFIED"
            and item.symbol in {symbol, "GLOBAL"}
        ]
        values = pd.Series(np.nan, index=frame.index, dtype="float64")
        available_dates = pd.Series(pd.NaT, index=frame.index, dtype="datetime64[ns, UTC]")
        expiry_dates = pd.Series(pd.NaT, index=frame.index, dtype="datetime64[ns, UTC]")
        if rows:
            evidence_frame = pd.DataFrame(
                {
                    "availableDate": pd.to_datetime([item.availableAt for item in rows], utc=True)
                    .normalize()
                    .astype("datetime64[ns, UTC]"),
                    "expiresDate": pd.to_datetime(
                        [item.expiresAt for item in rows], utc=True, errors="coerce"
                    )
                    .normalize()
                    .astype("datetime64[ns, UTC]"),
                    "value": [item.value for item in rows],
                }
            ).sort_values("availableDate")
            aligned = pd.merge_asof(
                pd.DataFrame({"tradeDate": trade_dates}).sort_values("tradeDate"),
                evidence_frame,
                left_on="tradeDate",
                right_on="availableDate",
                direction="backward",
            ).sort_index()
            values = aligned["value"].astype("float64")
            available_dates = aligned["availableDate"]
            expiry_dates = aligned["expiresDate"]
        state[metric] = values
        state[f"{metric}_availableDate"] = available_dates
        state[f"{metric}_expiresDate"] = expiry_dates

    max_ages = {
        "FUNDAMENTAL_GROWTH_SCORE": params.fundamentalMaxAgeDays,
        "ORDER_BOOK_IMBALANCE": params.orderBookMaxAgeDays,
        "FINANCIAL_CONDITIONS_Z": params.financingMaxAgeDays,
        "SHORT_INTEREST_PERCENT": params.shortInterestMaxAgeDays,
        "DAYS_TO_COVER": params.shortInterestMaxAgeDays,
    }
    ready = pd.Series(True, index=frame.index)
    for metric, max_age in max_ages.items():
        age = (trade_dates - state[f"{metric}_availableDate"]).dt.days
        not_expired = state[f"{metric}_expiresDate"].isna() | (
            trade_dates <= state[f"{metric}_expiresDate"]
        )
        ready &= state[metric].notna() & age.between(0, max_age) & not_expired
    external_safe = (
        (state["FUNDAMENTAL_GROWTH_SCORE"] >= params.minimumFundamentalGrowthScore)
        & (state["ORDER_BOOK_IMBALANCE"] >= params.minimumOrderBookImbalance)
        & (state["FINANCIAL_CONDITIONS_Z"] <= params.maximumFinancialConditionsZ)
        & (state["SHORT_INTEREST_PERCENT"] <= params.maximumShortInterestPercent)
        & (state["DAYS_TO_COVER"] <= params.maximumDaysToCover)
    )
    state["externalReady"] = ready
    state["externalSafe"] = ready & external_safe.fillna(False)
    proxy_safe = state["trendIsUp"] & ~state["proxyLiquidityStress"] & ~state["proxyCrowdingStress"]
    if params.dataMode == "REQUIRE_VERIFIED_REAL":
        state["safeToHold"] = (
            state["externalSafe"] & ~state["proxyLiquidityStress"] & ~state["proxyCrowdingStress"]
        )
    else:
        state["safeToHold"] = state["externalSafe"].where(state["externalReady"], proxy_safe)
    return state


def _signal_columns(frame: pd.DataFrame, request: BacktestRequest) -> tuple[pd.Series, pd.Series]:
    params = validate_strategy_parameters(request.strategyType, request.parameters)
    buy = pd.Series(False, index=frame.index)
    sell = pd.Series(False, index=frame.index)
    close = frame["backtest_close"]
    if request.strategyType == "BuyAndHold":
        buy.iloc[0] = True
    elif request.strategyType == "MovingAverageCross":
        assert isinstance(params, MovingAverageCrossParameters)
        short = sma(close, params.shortPeriod)
        long = sma(close, params.longPeriod)
        buy = (short > long) & (short.shift(1) <= long.shift(1))
        sell = (short < long) & (short.shift(1) >= long.shift(1))
    elif request.strategyType == "RsiMeanReversion":
        assert isinstance(params, RsiMeanReversionParameters)
        oscillator = rsi(close, params.period)
        buy = oscillator < params.buyThreshold
        sell = oscillator > params.sellThreshold
    elif request.strategyType == "TimeSeriesMomentum":
        assert isinstance(params, TimeSeriesMomentumParameters)
        momentum_ready = close.shift(params.lookbackDays).notna()
        momentum_positive = close > close.shift(params.lookbackDays)
        previous_positive = momentum_positive.shift(1, fill_value=False)
        buy = momentum_ready & momentum_positive & ~previous_positive
        sell = momentum_ready & ~momentum_positive & previous_positive
    else:
        assert isinstance(params, FundamentalLiquidityCrowdingParameters)
        state = three_layer_state(frame, request.evidence, params)
        safe_to_hold = state["safeToHold"]
        buy = safe_to_hold & ~safe_to_hold.shift(1, fill_value=False)
        sell = ~safe_to_hold
    return buy.fillna(False), sell.fillna(False)


def _max_streak(values: list[float], positive: bool) -> int:
    best = current = 0
    for value in values:
        matched = value > 0 if positive else value < 0
        current = current + 1 if matched else 0
        best = max(best, current)
    return best


def calculate_metrics(
    equity: pd.Series,
    benchmark: pd.Series,
    closed_pnls: list[float],
    holding_days: list[int],
    position_values: pd.Series,
    commissions: float,
    slippage: float,
    initial_capital: float,
) -> tuple[dict[str, float | int | None], list[dict[str, float | str]]]:
    final_equity = float(equity.iloc[-1])
    total_return = (final_equity / initial_capital - 1) * 100
    days = max((equity.index[-1] - equity.index[0]).days, 1)
    years = days / 365.25
    annual_log_growth = math.log(final_equity / initial_capital) / years
    cagr = (math.exp(annual_log_growth) - 1) * 100 if annual_log_growth < 700 else None
    daily_returns = equity.pct_change().dropna()
    daily_return_percent = daily_returns * 100
    historical_var_95 = (
        float(daily_return_percent.quantile(0.05)) if len(daily_return_percent) >= 20 else None
    )
    expected_shortfall_95 = None
    if historical_var_95 is not None:
        tail_returns = daily_return_percent[daily_return_percent <= historical_var_95]
        if not tail_returns.empty:
            expected_shortfall_95 = float(tail_returns.mean())
    worst_daily_return = (
        float(daily_return_percent.min()) if not daily_return_percent.empty else None
    )
    running_peak = equity.cummax()
    drawdown = equity / running_peak - 1
    max_drawdown = float(drawdown.min() * 100)
    volatility = (
        float(daily_returns.std(ddof=1) * math.sqrt(252) * 100) if len(daily_returns) > 1 else 0
    )
    std = float(daily_returns.std(ddof=1)) if len(daily_returns) > 1 else 0
    sharpe = float(daily_returns.mean() / std * math.sqrt(252)) if std > 0 else 0
    downside = daily_returns[daily_returns < 0]
    downside_std = float(downside.std(ddof=1)) if len(downside) > 1 else 0
    sortino = float(daily_returns.mean() / downside_std * math.sqrt(252)) if downside_std > 0 else 0
    wins = [value for value in closed_pnls if value > 0]
    losses = [value for value in closed_pnls if value < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    average_win = sum(wins) / len(wins) if wins else None
    average_loss = gross_loss / len(losses) if losses else None
    expectancy_per_trade = sum(closed_pnls) / len(closed_pnls) if closed_pnls else None
    expectancy_r = (
        expectancy_per_trade / average_loss
        if expectancy_per_trade is not None and average_loss is not None and average_loss != 0
        else None
    )
    break_even_win_rate = (
        average_loss / (average_win + average_loss) * 100
        if average_win is not None and average_loss is not None
        else None
    )
    profit_factor = (
        gross_profit / gross_loss if gross_loss > 0 else (0 if gross_profit == 0 else None)
    )
    payoff_ratio = (
        (sum(wins) / len(wins)) / abs(sum(losses) / len(losses)) if wins and losses else None
    )
    benchmark_return = (float(benchmark.iloc[-1]) / initial_capital - 1) * 100
    utilization = float((position_values / equity.replace(0, np.nan)).fillna(0).mean() * 100)
    metrics: dict[str, float | int | None] = {
        "initialCapital": round(initial_capital, 4),
        "finalEquity": round(final_equity, 4),
        "totalReturn": round(total_return, 6),
        "cagr": round(cagr, 6) if cagr is not None else None,
        "maxDrawdown": round(max_drawdown, 6),
        "annualVolatility": round(volatility, 6),
        "historicalVaR95": (round(historical_var_95, 6) if historical_var_95 is not None else None),
        "expectedShortfall95": (
            round(expected_shortfall_95, 6) if expected_shortfall_95 is not None else None
        ),
        "worstDailyReturn": (
            round(worst_daily_return, 6) if worst_daily_return is not None else None
        ),
        "sharpeRatio": round(sharpe, 6),
        "sortinoRatio": round(sortino, 6),
        "winRate": round(len(wins) / len(closed_pnls) * 100, 6) if closed_pnls else 0,
        "profitFactor": round(profit_factor, 6) if profit_factor is not None else None,
        "payoffRatio": round(payoff_ratio, 6) if payoff_ratio is not None else None,
        "averageWin": round(average_win, 6) if average_win is not None else None,
        "averageLoss": round(average_loss, 6) if average_loss is not None else None,
        "expectancyPerTrade": (
            round(expectancy_per_trade, 6) if expectancy_per_trade is not None else None
        ),
        "expectancyR": round(expectancy_r, 6) if expectancy_r is not None else None,
        "breakEvenWinRate": (
            round(break_even_win_rate, 6) if break_even_win_rate is not None else None
        ),
        "totalTrades": len(closed_pnls),
        "executionCount": len(closed_pnls) * 2,
        "averageHoldingDays": (
            round(sum(holding_days) / len(holding_days), 4) if holding_days else 0
        ),
        "maxConsecutiveWins": _max_streak(closed_pnls, True),
        "maxConsecutiveLosses": _max_streak(closed_pnls, False),
        "capitalUtilization": round(utilization, 6),
        "benchmarkReturn": round(benchmark_return, 6),
        "excessReturn": round(total_return - benchmark_return, 6),
        "totalCommission": round(commissions, 4),
        "totalSlippage": round(slippage, 4),
    }
    monthly_equity = equity.resample("ME").last()
    monthly = monthly_equity.pct_change()
    if not monthly.empty:
        monthly.iloc[0] = monthly_equity.iloc[0] / initial_capital - 1
    monthly_returns: list[dict[str, float | str]] = [
        {
            "month": pd.Timestamp(cast(Any, timestamp)).strftime("%Y-%m"),
            "return": round(float(value) * 100, 6),
        }
        for timestamp, value in monthly.dropna().items()
    ]
    return metrics, monthly_returns


def run_backtest(request: BacktestRequest) -> dict[str, Any]:
    if request.strategyType in {
        "MultiHorizonTrend",
        "DualMomentumRotation",
        "CoreSatelliteMomentum",
    }:
        from app.allocation_backtest import run_allocation_backtest

        return run_allocation_backtest(request)
    params = validate_strategy_parameters(request.strategyType, request.parameters)
    frame = _frame(request)
    buy_signals, sell_signals = _signal_columns(frame, request)
    if request.evaluationStartDate is not None:
        evaluation_mask = frame["tradeDate"].dt.date >= request.evaluationStartDate
        evaluation_indices = frame.index[evaluation_mask]
        if len(evaluation_indices) == 0:
            raise ValueError("评估起始日之后没有行情")
        first_evaluation_index = int(evaluation_indices[0])
        if request.strategyType == "TimeSeriesMomentum":
            assert isinstance(params, TimeSeriesMomentumParameters)
            warmup_index = first_evaluation_index - params.lookbackDays
            if warmup_index < 0:
                raise ValueError("时间序列动量的暖机行情不足")
            momentum_positive = float(frame.iloc[first_evaluation_index]["backtest_close"]) > float(
                frame.iloc[warmup_index]["backtest_close"]
            )
            buy_signals.iloc[first_evaluation_index] = momentum_positive
            sell_signals.iloc[first_evaluation_index] = False
        frame = frame.loc[evaluation_mask].reset_index(drop=True)
        buy_signals = buy_signals.loc[evaluation_mask].reset_index(drop=True)
        sell_signals = sell_signals.loc[evaluation_mask].reset_index(drop=True)
    portfolio = Portfolio(cash=request.initialCapital)
    pending: dict[str, Any] | None = None
    trades: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    closed_pnls: list[float] = []
    holding_days: list[int] = []
    total_commission = 0.0
    total_slippage = 0.0
    benchmark_quantity = 0.0
    benchmark_cash = request.initialCapital
    random = np.random.default_rng(request.randomSeed)

    for index, (_, row) in enumerate(frame.iterrows()):
        trade_date = row["tradeDate"].date()
        raw_open = float(row["backtest_open"])
        close = float(row["backtest_close"])

        if request.priceMode == "RAW_WITH_ACTIONS" and portfolio.quantity > 0:
            split_factor = float(row["splitFactor"])
            if split_factor != 1:
                portfolio.quantity *= split_factor
                portfolio.avg_cost /= split_factor
            portfolio.cash += portfolio.quantity * float(row["dividend"])

        if index == 1:
            benchmark_execution_price = raw_open * (
                1 + request.slippageRate + request.adverseOpenRate
            )
            benchmark_quantity = _affordable_quantity(
                request, benchmark_cash, benchmark_execution_price
            )
            benchmark_notional = benchmark_quantity * benchmark_execution_price
            benchmark_commission = _commission(request, benchmark_quantity, benchmark_notional)
            benchmark_cash -= benchmark_notional + benchmark_commission

        if pending is not None and index >= int(pending["executeIndex"]):
            if pending["side"] == "BUY" and portfolio.quantity == 0:
                execution_price = raw_open * (1 + request.slippageRate + request.adverseOpenRate)
                allocation = min(
                    portfolio.cash,
                    float(pending["requestedAmount"]),
                )
                quantity = _affordable_quantity(request, allocation, execution_price)
                if quantity <= 0:
                    rejected.append(
                        {
                            "signalTime": pending["signalTime"],
                            "executionTime": trade_date.isoformat(),
                            "side": "BUY",
                            "reason": "现金不足，无法购买最小一股",
                        }
                    )
                else:
                    notional = quantity * execution_price
                    commission = _commission(request, quantity, notional)
                    slippage = quantity * raw_open * request.slippageRate
                    portfolio.buy(quantity, execution_price, commission, trade_date)
                    total_commission += commission
                    total_slippage += slippage
                    trades.append(
                        {
                            "symbol": row["symbol"],
                            "side": "BUY",
                            "signalTime": pending["signalTime"],
                            "orderTime": trade_date.isoformat(),
                            "executionTime": trade_date.isoformat(),
                            "executionPrice": round(execution_price, 6),
                            "quantity": quantity,
                            "notional": round(notional, 4),
                            "commission": round(commission, 4),
                            "slippage": round(slippage, 4),
                            "realizedPnl": None,
                            "holdingDays": None,
                            "triggerReason": pending["reason"],
                        }
                    )
            elif pending["side"] == "SELL" and portfolio.quantity > 0:
                entry_date = portfolio.entry_date
                sell_quantity = portfolio.quantity
                execution_price = raw_open * (1 - request.slippageRate - request.adverseOpenRate)
                notional = sell_quantity * execution_price
                commission = _commission(request, sell_quantity, notional)
                slippage = sell_quantity * raw_open * request.slippageRate
                realized = portfolio.sell(sell_quantity, execution_price, commission)
                days_held = (trade_date - entry_date).days if entry_date else 0
                total_commission += commission
                total_slippage += slippage
                closed_pnls.append(realized)
                holding_days.append(days_held)
                trades.append(
                    {
                        "symbol": row["symbol"],
                        "side": "SELL",
                        "signalTime": pending["signalTime"],
                        "orderTime": trade_date.isoformat(),
                        "executionTime": trade_date.isoformat(),
                        "executionPrice": round(execution_price, 6),
                        "quantity": sell_quantity,
                        "notional": round(notional, 4),
                        "commission": round(commission, 4),
                        "slippage": round(slippage, 4),
                        "realizedPnl": round(realized, 4),
                        "holdingDays": days_held,
                        "triggerReason": pending["reason"],
                    }
                )
            pending = None

        position_value = portfolio.quantity * close
        equity = portfolio.cash + position_value
        benchmark_equity = benchmark_cash + benchmark_quantity * close
        points.append(
            {
                "tradeDate": trade_date.isoformat(),
                "equity": round(equity, 4),
                "cash": round(portfolio.cash, 4),
                "positionValue": round(position_value, 4),
                "benchmarkEquity": round(benchmark_equity, 4),
            }
        )

        side: str | None = None
        reason = ""
        if bool(buy_signals.iloc[index]) and portfolio.quantity == 0 and pending is None:
            side = "BUY"
            reason = {
                "BuyAndHold": "首个收盘信号：买入并持有",
                "MovingAverageCross": "短期均线上穿长期均线",
                "RsiMeanReversion": "RSI 低于买入阈值",
                "TimeSeriesMomentum": "回看期收益由非正转为正，进入长期动量状态",
                "FundamentalLiquidityCrowding": "三层证据满足开仓条件，且流动性与拥挤压力均未触发",
            }[request.strategyType]
        elif bool(sell_signals.iloc[index]) and portfolio.quantity > 0 and pending is None:
            if (
                isinstance(params, RsiMeanReversionParameters)
                and portfolio.entry_date is not None
                and (trade_date - portfolio.entry_date).days < params.minimumHoldingDays
            ):
                continue
            side = "SELL"
            reason = {
                "BuyAndHold": "",
                "MovingAverageCross": "短期均线下穿长期均线",
                "RsiMeanReversion": "RSI 高于卖出阈值",
                "TimeSeriesMomentum": "回看期收益由正转为非正，退出长期动量状态",
                "FundamentalLiquidityCrowding": "三层证据缺失、过期或越过风险阈值",
            }[request.strategyType]
        if (
            side
            and request.skipTradePercent > 0
            and random.random() < request.skipTradePercent / 100
        ):
            rejected.append(
                {
                    "signalTime": trade_date.isoformat(),
                    "executionTime": None,
                    "side": side,
                    "reason": "压力测试按固定随机种子跳过信号",
                }
            )
            side = None
        if side:
            requested_amount = equity * params.positionPercent / 100
            signal = {
                "symbol": row["symbol"],
                "side": side,
                "signalTime": trade_date.isoformat(),
                "referencePrice": round(close, 6),
                "requestedAmount": round(requested_amount, 4),
                "stopLossCondition": params.stopLossCondition,
                "exitCondition": params.exitCondition,
                "reason": reason,
            }
            signals.append(signal)
            execute_index = index + 1 + request.signalDelayDays
            if execute_index < len(frame):
                pending = {**signal, "executeIndex": execute_index}

    equity_series = pd.Series(
        [point["equity"] for point in points],
        index=pd.DatetimeIndex([point["tradeDate"] for point in points]),
        dtype="float64",
    )
    position_series = pd.Series(
        [point["positionValue"] for point in points], index=equity_series.index, dtype="float64"
    )
    benchmark_series = pd.Series(
        [point["benchmarkEquity"] for point in points],
        index=equity_series.index,
        dtype="float64",
    )
    running_peak = equity_series.cummax()
    drawdowns = (equity_series / running_peak - 1) * 100
    for point, drawdown in zip(points, drawdowns, strict=True):
        point["drawdown"] = round(float(drawdown), 6)
    metrics, monthly_returns = calculate_metrics(
        equity_series,
        benchmark_series,
        closed_pnls,
        holding_days,
        position_series,
        total_commission,
        total_slippage,
        request.initialCapital,
    )
    metrics["completedTrades"] = len(closed_pnls)
    metrics["executionCount"] = len(trades)
    metrics["totalTrades"] = len(trades)
    last_price = float(frame.iloc[-1]["backtest_close"])
    positions = (
        [
            {
                "symbol": frame.iloc[-1]["symbol"],
                "quantity": portfolio.quantity,
                "avgCost": round(portfolio.avg_cost, 6),
                "lastPrice": round(last_price, 6),
                "marketValue": round(portfolio.quantity * last_price, 4),
                "unrealizedPnl": round(portfolio.quantity * (last_price - portfolio.avg_cost), 4),
            }
        ]
        if portfolio.quantity > 0
        else []
    )
    return {
        "engineVersion": "1.4.0",
        "strategyType": request.strategyType,
        "priceMode": request.priceMode,
        "metrics": metrics,
        "monthlyReturns": monthly_returns,
        "equityPoints": points,
        "trades": trades,
        "positions": positions,
        "signals": signals,
        "rejectedOrders": rejected,
        "riskNotice": (
            "回测仅用于研究；收盘信号在下一交易日开盘成交，默认禁止融资、裸空和自动下单。"
            + (
                "手续费采用 IBKR Pro 美国股票阶梯基础佣金（每股费率、每单最低费用和订单金额上限）；"
                "不含会随路由和成交变化的交易所、清算、监管费用或返佣。"
                if request.commissionModel == "IBKR_US_EQUITY_TIERED_BASE"
                else "手续费采用成交名义金额比例模型。"
            )
        ),
    }
