from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

import numpy as np
import pandas as pd

from app.models import (
    BacktestRequest,
    CoreSatelliteMomentumParameters,
    DualMomentumRotationParameters,
    MultiHorizonTrendParameters,
    validate_strategy_parameters,
)


@dataclass
class AssetPosition:
    quantity: int
    avg_cost: float
    entry_date: date


@dataclass
class AllocationPortfolio:
    cash: float
    positions: dict[str, AssetPosition]


def _required_symbols(
    parameters: MultiHorizonTrendParameters
    | DualMomentumRotationParameters
    | CoreSatelliteMomentumParameters,
) -> tuple[list[str], str]:
    if isinstance(parameters, MultiHorizonTrendParameters):
        return [parameters.symbol], parameters.symbol
    if isinstance(parameters, DualMomentumRotationParameters):
        symbols = [*parameters.riskAssets, parameters.defensiveAsset, parameters.benchmarkSymbol]
        return list(dict.fromkeys(symbols)), parameters.benchmarkSymbol
    symbols = [
        parameters.coreSymbol,
        *parameters.satelliteAssets,
        parameters.defensiveAsset,
        parameters.benchmarkSymbol,
    ]
    return list(dict.fromkeys(symbols)), parameters.benchmarkSymbol


def _target_weights(
    parameters: MultiHorizonTrendParameters
    | DualMomentumRotationParameters
    | CoreSatelliteMomentumParameters,
    closes: pd.DataFrame,
    index: int,
) -> tuple[dict[str, float], str]:
    if isinstance(parameters, MultiHorizonTrendParameters):
        current = float(closes.iloc[index][parameters.symbol])
        positive = sum(
            current > float(closes.iloc[index - horizon][parameters.symbol])
            for horizon in parameters.lookbackDays
        )
        if positive >= parameters.minimumPositiveHorizons:
            return (
                {parameters.symbol: parameters.positionPercent / 100},
                f"多周期趋势：{positive}/{len(parameters.lookbackDays)} 个周期为正，"
                f"目标持有 {parameters.symbol}",
            )
        return (
            {},
            f"多周期趋势：{positive}/{len(parameters.lookbackDays)} 个周期为正，"
            "低于持有门槛，目标现金",
        )

    lookback = parameters.lookbackDays
    current_prices = closes.iloc[index]
    previous = closes.iloc[index - lookback]
    returns = current_prices / previous - 1
    if isinstance(parameters, DualMomentumRotationParameters):
        leader = max(parameters.riskAssets, key=lambda symbol: float(returns[symbol]))
        leader_return = float(returns[leader])
        defensive_return = float(returns[parameters.defensiveAsset])
        selected = leader if leader_return > defensive_return else parameters.defensiveAsset
        reason = (
            f"月度双动量：风险资产最强 {leader} {leader_return * 100:.2f}%，"
            f"防御基准 {parameters.defensiveAsset} {defensive_return * 100:.2f}%，选择 {selected}"
        )
        return {selected: parameters.positionPercent / 100}, reason

    leader = max(parameters.satelliteAssets, key=lambda symbol: float(returns[symbol]))
    leader_return = float(returns[leader])
    defensive_return = float(returns[parameters.defensiveAsset])
    selected = leader if leader_return > defensive_return else parameters.defensiveAsset
    satellite_weight = (parameters.positionPercent - parameters.corePercent) / 100
    reason = (
        f"核心卫星月度再平衡：核心 {parameters.coreSymbol} {parameters.corePercent:.2f}%；"
        f"卫星最强 {leader} {leader_return * 100:.2f}%，"
        f"防御基准 {parameters.defensiveAsset} {defensive_return * 100:.2f}%，卫星选择 {selected}"
    )
    return (
        {
            parameters.coreSymbol: parameters.corePercent / 100,
            selected: satellite_weight,
        },
        reason,
    )


def run_allocation_backtest(request: BacktestRequest) -> dict[str, Any]:
    # Imported locally to keep the single-asset engine and its established helpers independent.
    from app.backtest import _affordable_quantity, _commission, _frame, calculate_metrics

    if request.priceMode != "ADJUSTED":
        raise ValueError("多资产研究候选当前只允许 ADJUSTED 复权价格模式")
    validated = validate_strategy_parameters(request.strategyType, request.parameters)
    if not isinstance(
        validated,
        (
            MultiHorizonTrendParameters,
            DualMomentumRotationParameters,
            CoreSatelliteMomentumParameters,
        ),
    ):
        raise ValueError("策略不是资产配置研究候选")
    required_symbols, benchmark_symbol = _required_symbols(validated)
    available_symbols = {bar.symbol for bar in request.bars}
    missing = [symbol for symbol in required_symbols if symbol not in available_symbols]
    if missing:
        raise ValueError(f"多资产回测缺少行情：{', '.join(missing)}")

    frame = _frame(request)
    opens = frame.pivot(index="tradeDate", columns="symbol", values="backtest_open")
    closes = frame.pivot(index="tradeDate", columns="symbol", values="backtest_close")
    common_dates = (
        opens[required_symbols].dropna().index.intersection(closes[required_symbols].dropna().index)
    )
    opens = opens.loc[common_dates, required_symbols].sort_index()
    closes = closes.loc[common_dates, required_symbols].sort_index()
    if len(opens) < 2:
        raise ValueError("多资产共同交易日期不足")

    maximum_lookback = (
        max(validated.lookbackDays)
        if isinstance(validated, MultiHorizonTrendParameters)
        else validated.lookbackDays
    )
    evaluation_start = request.evaluationStartDate or cast(pd.Timestamp, opens.index[0]).date()
    evaluation_positions = [
        index
        for index, timestamp in enumerate(opens.index)
        if cast(pd.Timestamp, timestamp).date() >= evaluation_start
    ]
    if not evaluation_positions:
        raise ValueError("评估起始日之后没有共同行情")
    first_evaluation_index = evaluation_positions[0]
    if first_evaluation_index < maximum_lookback:
        raise ValueError(f"资产配置策略需要每个标的至少 {maximum_lookback} 根暖机行情")

    portfolio = AllocationPortfolio(cash=request.initialCapital, positions={})
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

    for local_index, source_index in enumerate(evaluation_positions):
        timestamp = cast(pd.Timestamp, opens.index[source_index])
        trade_date = timestamp.date()
        open_prices = opens.iloc[source_index]
        close_prices = closes.iloc[source_index]

        if local_index == 1:
            benchmark_execution_price = float(open_prices[benchmark_symbol]) * (
                1 + request.slippageRate + request.adverseOpenRate
            )
            benchmark_quantity = _affordable_quantity(
                request, benchmark_cash, benchmark_execution_price
            )
            benchmark_notional = benchmark_quantity * benchmark_execution_price
            benchmark_commission = _commission(request, benchmark_quantity, benchmark_notional)
            benchmark_cash -= benchmark_notional + benchmark_commission

        if pending is not None and local_index >= int(pending["executeIndex"]):
            target_weights = cast(dict[str, float], pending["targetWeights"])
            pretrade_equity = portfolio.cash + sum(
                position.quantity * float(open_prices[symbol])
                for symbol, position in portfolio.positions.items()
            )
            desired_quantities = {
                symbol: math.floor(pretrade_equity * weight / float(open_prices[symbol]))
                for symbol, weight in target_weights.items()
            }

            for symbol in sorted(list(portfolio.positions)):
                position = portfolio.positions[symbol]
                desired = desired_quantities.get(symbol, 0)
                sell_quantity = max(0, position.quantity - desired)
                if sell_quantity == 0:
                    continue
                raw_open = float(open_prices[symbol])
                execution_price = raw_open * (1 - request.slippageRate - request.adverseOpenRate)
                notional = sell_quantity * execution_price
                commission = _commission(request, sell_quantity, notional)
                slippage = sell_quantity * raw_open * request.slippageRate
                proceeds = notional - commission
                realized = proceeds - sell_quantity * position.avg_cost
                portfolio.cash += proceeds
                position.quantity -= sell_quantity
                total_commission += commission
                total_slippage += slippage
                closed_pnls.append(realized)
                days_held = (trade_date - position.entry_date).days
                holding_days.append(days_held)
                trades.append(
                    {
                        "symbol": symbol,
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
                signals.append(
                    {
                        "symbol": symbol,
                        "side": "SELL",
                        "signalTime": pending["signalTime"],
                        "referencePrice": round(float(pending["referencePrices"][symbol]), 6),
                        "requestedAmount": round(
                            pretrade_equity * target_weights.get(symbol, 0), 4
                        ),
                        "stopLossCondition": validated.stopLossCondition,
                        "exitCondition": validated.exitCondition,
                        "reason": pending["reason"],
                    }
                )
                if position.quantity == 0:
                    del portfolio.positions[symbol]

            for symbol in sorted(target_weights):
                desired = desired_quantities[symbol]
                current = portfolio.positions.get(symbol)
                buy_quantity = desired - (current.quantity if current else 0)
                if buy_quantity <= 0:
                    continue
                raw_open = float(open_prices[symbol])
                execution_price = raw_open * (1 + request.slippageRate + request.adverseOpenRate)
                affordable = _affordable_quantity(request, portfolio.cash, execution_price)
                buy_quantity = min(buy_quantity, affordable)
                if buy_quantity <= 0:
                    rejected.append(
                        {
                            "signalTime": pending["signalTime"],
                            "executionTime": trade_date.isoformat(),
                            "side": "BUY",
                            "symbol": symbol,
                            "reason": "再平衡后现金不足，无法购买最小一股",
                        }
                    )
                    continue
                notional = buy_quantity * execution_price
                commission = _commission(request, buy_quantity, notional)
                slippage = buy_quantity * raw_open * request.slippageRate
                total_cost = notional + commission
                portfolio.cash -= total_cost
                if current is None:
                    portfolio.positions[symbol] = AssetPosition(
                        quantity=buy_quantity,
                        avg_cost=total_cost / buy_quantity,
                        entry_date=trade_date,
                    )
                else:
                    old_cost = current.quantity * current.avg_cost
                    current.quantity += buy_quantity
                    current.avg_cost = (old_cost + total_cost) / current.quantity
                total_commission += commission
                total_slippage += slippage
                trades.append(
                    {
                        "symbol": symbol,
                        "side": "BUY",
                        "signalTime": pending["signalTime"],
                        "orderTime": trade_date.isoformat(),
                        "executionTime": trade_date.isoformat(),
                        "executionPrice": round(execution_price, 6),
                        "quantity": buy_quantity,
                        "notional": round(notional, 4),
                        "commission": round(commission, 4),
                        "slippage": round(slippage, 4),
                        "realizedPnl": None,
                        "holdingDays": None,
                        "triggerReason": pending["reason"],
                    }
                )
                signals.append(
                    {
                        "symbol": symbol,
                        "side": "BUY",
                        "signalTime": pending["signalTime"],
                        "referencePrice": round(float(pending["referencePrices"][symbol]), 6),
                        "requestedAmount": round(pretrade_equity * target_weights[symbol], 4),
                        "stopLossCondition": validated.stopLossCondition,
                        "exitCondition": validated.exitCondition,
                        "reason": pending["reason"],
                    }
                )
            pending = None

        position_value = sum(
            position.quantity * float(close_prices[symbol])
            for symbol, position in portfolio.positions.items()
        )
        equity = portfolio.cash + position_value
        benchmark_equity = benchmark_cash + benchmark_quantity * float(
            close_prices[benchmark_symbol]
        )
        points.append(
            {
                "tradeDate": trade_date.isoformat(),
                "equity": round(equity, 4),
                "cash": round(portfolio.cash, 4),
                "positionValue": round(position_value, 4),
                "benchmarkEquity": round(benchmark_equity, 4),
            }
        )

        previous_timestamp = (
            cast(pd.Timestamp, opens.index[source_index - 1]) if source_index > 0 else None
        )
        is_monthly_rebalance = local_index == 0 or (
            previous_timestamp is not None
            and (timestamp.year, timestamp.month)
            != (previous_timestamp.year, previous_timestamp.month)
        )
        if is_monthly_rebalance and pending is None:
            target_weights, reason = _target_weights(validated, closes, source_index)
            if request.skipTradePercent > 0 and random.random() < request.skipTradePercent / 100:
                rejected.append(
                    {
                        "signalTime": trade_date.isoformat(),
                        "executionTime": None,
                        "side": "REBALANCE",
                        "reason": "压力测试按固定随机种子跳过整次月度再平衡",
                    }
                )
            else:
                execute_index = local_index + 1 + request.signalDelayDays
                if execute_index < len(evaluation_positions):
                    pending = {
                        "executeIndex": execute_index,
                        "signalTime": trade_date.isoformat(),
                        "targetWeights": target_weights,
                        "referencePrices": {
                            symbol: float(close_prices[symbol]) for symbol in required_symbols
                        },
                        "reason": reason,
                    }

    equity_series = pd.Series(
        [point["equity"] for point in points],
        index=pd.DatetimeIndex([point["tradeDate"] for point in points]),
        dtype="float64",
    )
    position_series = pd.Series(
        [point["positionValue"] for point in points],
        index=equity_series.index,
        dtype="float64",
    )
    benchmark_series = pd.Series(
        [point["benchmarkEquity"] for point in points],
        index=equity_series.index,
        dtype="float64",
    )
    drawdowns = (equity_series / equity_series.cummax() - 1) * 100
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
    last_closes = closes.iloc[evaluation_positions[-1]]
    positions = [
        {
            "symbol": symbol,
            "quantity": position.quantity,
            "avgCost": round(position.avg_cost, 6),
            "lastPrice": round(float(last_closes[symbol]), 6),
            "marketValue": round(position.quantity * float(last_closes[symbol]), 4),
            "unrealizedPnl": round(
                position.quantity * (float(last_closes[symbol]) - position.avg_cost), 4
            ),
        }
        for symbol, position in sorted(portfolio.positions.items())
    ]
    cost_notice = (
        "手续费采用 IBKR Pro 美国股票阶梯基础佣金；"
        "不含会随路由和成交变化的交易所、清算、监管费用或返佣。"
        if request.commissionModel == "IBKR_US_EQUITY_TIERED_BASE"
        else "手续费采用成交名义金额比例模型。"
    )
    return {
        "engineVersion": "1.7.0",
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
            "回测仅用于研究；月度收盘信息最早在下一共同交易日开盘执行，不使用未来收益。"
            "候选策略保持研究状态，不生成实盘订单。" + cost_notice
        ),
    }
