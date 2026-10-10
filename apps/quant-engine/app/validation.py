from __future__ import annotations

import itertools
import math
from typing import Any

import numpy as np
import pandas as pd

from app.backtest import run_backtest, three_layer_state
from app.indicators import rsi, sma
from app.models import (
    BacktestRequest,
    FundamentalLiquidityCrowdingParameters,
    MarketBar,
    MovingAverageCrossParameters,
    RobustnessValidationRequest,
    RsiMeanReversionParameters,
    SignalGenerationRequest,
    TimeSeriesMomentumParameters,
    validate_strategy_parameters,
)


def _backtest(
    request: RobustnessValidationRequest,
    bars: list[MarketBar],
    parameters: dict[str, Any] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "strategyType": request.strategyType,
        "parameters": parameters or request.parameters,
        "bars": bars,
        "evidence": request.evidence,
        "initialCapital": request.initialCapital,
        "commissionRate": request.commissionRate,
        "slippageRate": request.slippageRate,
        "randomSeed": request.randomSeed,
    }
    payload.update(overrides)
    return run_backtest(BacktestRequest.model_validate(payload))


def _summary(result: dict[str, Any]) -> dict[str, Any]:
    metrics = result["metrics"]
    return {
        "totalReturn": metrics["totalReturn"],
        "cagr": metrics["cagr"],
        "maxDrawdown": metrics["maxDrawdown"],
        "annualVolatility": metrics["annualVolatility"],
        "historicalVaR95": metrics["historicalVaR95"],
        "expectedShortfall95": metrics["expectedShortfall95"],
        "worstDailyReturn": metrics["worstDailyReturn"],
        "sharpeRatio": metrics["sharpeRatio"],
        "sortinoRatio": metrics["sortinoRatio"],
        "winRate": metrics["winRate"],
        "profitFactor": metrics["profitFactor"],
        "payoffRatio": metrics["payoffRatio"],
        "averageWin": metrics["averageWin"],
        "averageLoss": metrics["averageLoss"],
        "expectancyPerTrade": metrics["expectancyPerTrade"],
        "expectancyR": metrics["expectancyR"],
        "breakEvenWinRate": metrics["breakEvenWinRate"],
        "executionCount": metrics["executionCount"],
        "completedTrades": metrics["completedTrades"],
        "totalCommission": metrics["totalCommission"],
        "benchmarkReturn": metrics["benchmarkReturn"],
        "excessReturn": metrics["excessReturn"],
        "finalEquity": metrics["finalEquity"],
    }


def _parameter_candidates(request: RobustnessValidationRequest) -> list[dict[str, Any]]:
    grid: dict[str, list[Any]]
    if not request.parameterGrid:
        base = request.parameters.copy()
        if request.strategyType == "MovingAverageCross":
            short = int(base.get("shortPeriod", 20))
            long = int(base.get("longPeriod", 60))
            grid = {
                "shortPeriod": sorted(
                    {max(2, short - 10), max(2, short - 5), short, short + 5, short + 10}
                ),
                "longPeriod": sorted(
                    {
                        max(short + 1, long - 20),
                        max(short + 1, long - 10),
                        long,
                        long + 10,
                        long + 20,
                    }
                ),
            }
        elif request.strategyType == "RsiMeanReversion":
            grid = {
                "period": [7, 14, 21],
                "buyThreshold": [25, 30, 35],
                "sellThreshold": [65, 70, 75],
                "positionPercent": [50, 75, 95],
                "minimumHoldingDays": [0, 5, 10],
            }
        elif request.strategyType == "TimeSeriesMomentum":
            grid = {"lookbackDays": [20, 40, 60, 90, 120, 180, 250]}
        elif request.strategyType == "FundamentalLiquidityCrowding":
            grid = {
                "trendPeriod": [60, 120, 200],
                "minimumDollarVolumeRatio": [0.35, 0.5, 0.75],
                "maximumIlliquidityMultiple": [2, 3, 5],
                "maximumCrowdingZScore": [2, 2.5, 3],
                "positionPercent": [50, 70],
            }
        else:
            grid = {"positionPercent": [50, 75, 95]}
    else:
        grid = request.parameterGrid
    keys = sorted(grid)
    candidates: list[dict[str, Any]] = []
    for values in itertools.product(*(grid[key] for key in keys)):
        candidate = {**request.parameters, **dict(zip(keys, values, strict=True))}
        try:
            validated = validate_strategy_parameters(request.strategyType, candidate)
        except ValueError:
            continue
        candidates.append(validated.model_dump())
    return candidates[:500]


def _parameter_sweep(
    request: RobustnessValidationRequest,
    bars: list[MarketBar],
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for parameters in _parameter_candidates(request):
        metrics = _summary(_backtest(request, bars, parameters))
        score = (
            float(metrics["totalReturn"])
            - abs(float(metrics["maxDrawdown"])) * 0.65
            + float(metrics["sharpeRatio"] or 0) * 5
        )
        rows.append({"parameters": parameters, "metrics": metrics, "rawScore": score})
    returns = np.array([row["metrics"]["totalReturn"] for row in rows], dtype=float)
    median = float(np.median(returns)) if len(returns) else 0
    std = float(np.std(returns)) if len(returns) else 0
    best = max(rows, key=lambda item: item["rawScore"], default=None)
    for row in rows:
        deviation = abs(float(row["metrics"]["totalReturn"]) - median)
        stability = max(
            0.0, min(100.0, 100 - deviation * 2 - abs(float(row["metrics"]["maxDrawdown"])))
        )
        flags: list[str] = []
        if row["metrics"]["executionCount"] < 20:
            flags.append("TOO_FEW_TRADES")
        if row["metrics"]["totalReturn"] > 20 and row["metrics"]["maxDrawdown"] < -25:
            flags.append("HIGH_RETURN_HIGH_DRAWDOWN")
        if stability < 40:
            flags.append("UNSTABLE_REGION")
        row["stabilityScore"] = round(stability, 6)
        row["flags"] = flags
        row.pop("rawScore", None)
    single_peak = bool(best and std > 0 and best["metrics"]["totalReturn"] > median + std * 2)
    return {
        "dimensions": request.parameterGrid,
        "results": rows,
        "summary": {
            "candidateCount": len(rows),
            "medianReturn": round(median, 6),
            "returnStd": round(std, 6),
            "stableRegionCount": sum(1 for row in rows if row["stabilityScore"] >= 60),
            "singlePeak": single_peak,
            "bestParameters": best["parameters"] if best else request.parameters,
        },
    }


def _walk_forward(
    request: RobustnessValidationRequest,
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    bars = sorted(request.bars, key=lambda bar: bar.tradeDate)
    dates = pd.DatetimeIndex([bar.tradeDate for bar in bars])
    first = dates[0]
    last = dates[-1]
    config = request.walkForward
    windows: list[dict[str, Any]] = []
    train_start = first
    train_end = first + pd.DateOffset(months=config.trainMonths) - pd.Timedelta(days=1)
    sequence = 1
    while train_end < last and sequence <= config.maxWindows:
        test_start = train_end + pd.Timedelta(days=1)
        test_end = min(
            test_start + pd.DateOffset(months=config.testMonths) - pd.Timedelta(days=1), last
        )
        effective_train_start = first if config.anchored else train_start
        train_bars = [
            bar for bar in bars if effective_train_start.date() <= bar.tradeDate <= train_end.date()
        ]
        test_bars = [bar for bar in bars if test_start.date() <= bar.tradeDate <= test_end.date()]
        if len(train_bars) >= 60 and len(test_bars) >= 20:
            local_candidates = candidates[:36] or [request.parameters]
            scored: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
            for parameters in local_candidates:
                train_result = _backtest(request, train_bars, parameters)
                metrics = _summary(train_result)
                score = float(metrics["totalReturn"]) - abs(float(metrics["maxDrawdown"])) * 0.75
                scored.append((score, parameters, metrics))
            _, selected, train_metrics = max(scored, key=lambda item: item[0])
            test_result = _backtest(request, test_bars, selected)
            test_metrics = _summary(test_result)
            windows.append(
                {
                    "sequence": sequence,
                    "windowType": "WALK_FORWARD",
                    "trainStart": train_bars[0].tradeDate.isoformat(),
                    "trainEnd": train_bars[-1].tradeDate.isoformat(),
                    "testStart": test_bars[0].tradeDate.isoformat(),
                    "testEnd": test_bars[-1].tradeDate.isoformat(),
                    "parameters": selected,
                    "trainMetrics": train_metrics,
                    "testMetrics": test_metrics,
                    "testEquityPoints": test_result["equityPoints"],
                    "testTrades": test_result["trades"],
                }
            )
        sequence += 1
        train_start += pd.DateOffset(months=config.testMonths)
        train_end += pd.DateOffset(months=config.testMonths)
    return windows


def _stress_tests(
    request: RobustnessValidationRequest,
    bars: list[MarketBar],
) -> dict[str, Any]:
    baseline = _summary(_backtest(request, bars))
    half_position = {
        **request.parameters,
        "positionPercent": max(1, float(request.parameters.get("positionPercent", 95)) / 2),
    }
    scenarios: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = [
        ("BASE_COMMISSION", {"commissionRate": request.commissionRate}, None),
        ("COMMISSION_2X", {"commissionRate": request.commissionRate * 2}, None),
        ("COMMISSION_5X", {"commissionRate": request.commissionRate * 5}, None),
        ("BASE_SLIPPAGE", {"slippageRate": request.slippageRate}, None),
        ("SLIPPAGE_2X", {"slippageRate": request.slippageRate * 2}, None),
        ("SLIPPAGE_5X", {"slippageRate": request.slippageRate * 5}, None),
        ("ADVERSE_OPEN", {"adverseOpenRate": 0.005}, None),
        ("SIGNAL_DELAY_1D", {"signalDelayDays": 1}, None),
        ("SKIP_TRADES_10_PERCENT", {"skipTradePercent": 10}, None),
        ("LOWER_CAPITAL", {"initialCapital": request.initialCapital * 0.5}, None),
        ("LOWER_POSITION_SIZE", {}, half_position),
    ]
    results: list[dict[str, Any]] = []
    for code, overrides, parameters in scenarios:
        result = _backtest(request, bars, parameters, **overrides)
        metrics = _summary(result)
        degradation = float(metrics["totalReturn"]) - float(baseline["totalReturn"])
        failed = bool(
            (baseline["totalReturn"] > 0 and metrics["totalReturn"] < 0)
            or metrics["maxDrawdown"] < -40
        )
        results.append(
            {
                "scenarioCode": code,
                "config": {**overrides, "parameters": parameters},
                "metrics": metrics,
                "returnDegradation": round(degradation, 6),
                "failed": failed,
            }
        )
    worst = min((row["returnDegradation"] for row in results), default=0)
    invalidated = sum(1 for row in results if row["failed"]) >= 5 or worst < -30
    return {
        "baselineMetrics": baseline,
        "results": results,
        "summary": {
            "invalidated": invalidated,
            "failedScenarioCount": sum(1 for row in results if row["failed"]),
            "worstReturnDegradation": worst,
        },
    }


def _regime_metrics(
    request: RobustnessValidationRequest,
    result: dict[str, Any],
) -> dict[str, Any]:
    bars = sorted(request.bars, key=lambda bar: bar.tradeDate)
    close = pd.Series(
        [bar.adjustedClose for bar in bars], index=pd.DatetimeIndex([bar.tradeDate for bar in bars])
    )
    ma200 = close.rolling(200, min_periods=60).mean()
    vol = close.pct_change().rolling(20, min_periods=10).std() * math.sqrt(252)
    labels = pd.Series("RANGE", index=close.index)
    labels[(close >= ma200) & (ma200.diff(20) > 0)] = "BULL"
    labels[(close < ma200) & (ma200.diff(20) < 0)] = "BEAR"
    labels[vol > 0.35] = "HIGH_VOLATILITY"
    equity = pd.Series(
        [point["equity"] for point in result["equityPoints"]],
        index=pd.DatetimeIndex([point["tradeDate"] for point in result["equityPoints"]]),
    )
    returns = equity.pct_change().fillna(0)
    output: dict[str, Any] = {}
    for regime in ["BULL", "BEAR", "RANGE", "HIGH_VOLATILITY"]:
        regime_returns = returns[labels.reindex(returns.index).fillna("RANGE") == regime]
        if regime_returns.empty:
            output[regime] = {"days": 0, "totalReturn": 0, "annualVolatility": 0}
            continue
        curve = (1 + regime_returns).cumprod()
        drawdown = curve / curve.cummax() - 1
        output[regime] = {
            "days": len(regime_returns),
            "totalReturn": round((float(curve.iloc[-1]) - 1) * 100, 6),
            "maxDrawdown": round(float(drawdown.min()) * 100, 6),
            "annualVolatility": round(float(regime_returns.std() * math.sqrt(252)) * 100, 6),
        }
    return output


def run_robustness_validation(request: RobustnessValidationRequest) -> dict[str, Any]:
    validate_strategy_parameters(request.strategyType, request.parameters)
    bars = sorted(request.bars, key=lambda bar: bar.tradeDate)
    split_index = max(2, min(len(bars) - 2, int(len(bars) * request.inSampleRatio)))
    in_sample_bars = bars[:split_index]
    out_sample_bars = bars[split_index:]
    in_sample = _backtest(request, in_sample_bars)
    out_sample = _backtest(request, out_sample_bars)
    sweep = _parameter_sweep(request, in_sample_bars)
    windows = _walk_forward(request, [row["parameters"] for row in sweep["results"]])
    stress = _stress_tests(request, out_sample_bars)
    full_result = _backtest(request, bars)
    cross_symbols: dict[str, Any] = {}
    for symbol, symbol_bars in request.crossSymbolBars.items():
        if len(symbol_bars) >= 120:
            cross_symbols[symbol] = _summary(_backtest(request, symbol_bars))
    in_metrics = _summary(in_sample)
    out_metrics = _summary(out_sample)
    warnings: list[dict[str, str]] = []
    if in_metrics["totalReturn"] > 0 and out_metrics["totalReturn"] < 0:
        warnings.append(
            {"code": "OOS_TURNED_NEGATIVE", "level": "DANGER", "message": "样本外收益由正转负"}
        )
    if out_metrics["executionCount"] < request.minimumOutOfSampleTrades:
        warnings.append(
            {"code": "OOS_TOO_FEW_TRADES", "level": "WARNING", "message": "样本外有效交易次数不足"}
        )
    benchmark_exempt = request.strategyType == "BuyAndHold"
    out_sample_expectancy = out_metrics["expectancyPerTrade"]
    if not benchmark_exempt and (
        out_sample_expectancy is None or float(out_sample_expectancy) <= 0
    ):
        warnings.append(
            {
                "code": "OOS_NON_POSITIVE_EXPECTANCY",
                "level": "DANGER",
                "message": "扣除佣金与滑点后，样本外单笔期望值不为正",
            }
        )
    if sweep["summary"]["singlePeak"]:
        warnings.append(
            {
                "code": "PARAMETER_SINGLE_PEAK",
                "level": "DANGER",
                "message": "最优参数呈孤立尖峰，存在过拟合风险",
            }
        )
    if stress["summary"]["invalidated"]:
        warnings.append(
            {"code": "STRESS_INVALIDATED", "level": "DANGER", "message": "压力测试使策略结论失效"}
        )
    degradation = float(out_metrics["totalReturn"]) - float(in_metrics["totalReturn"])
    if degradation < -20:
        warnings.append(
            {"code": "OOS_LARGE_DEGRADATION", "level": "WARNING", "message": "样本外收益显著退化"}
        )
    criteria = {
        "outOfSampleNonNegative": out_metrics["totalReturn"] >= 0,
        "outOfSampleTradeCount": benchmark_exempt
        or out_metrics["executionCount"] >= request.minimumOutOfSampleTrades,
        "maxDrawdownWithinLimit": out_metrics["maxDrawdown"] >= -30,
        "stressSurvived": not stress["summary"]["invalidated"],
        "parameterRegionStable": benchmark_exempt or sweep["summary"]["stableRegionCount"] > 0,
        "positiveOutOfSampleExpectancy": benchmark_exempt
        or (out_sample_expectancy is not None and float(out_sample_expectancy) > 0),
    }
    pass_count = sum(1 for passed in criteria.values() if passed)
    robustness_score = round(pass_count / len(criteria) * 100, 6)
    recommendation = "PAPER_APPROVE_CANDIDATE" if all(criteria.values()) else "REJECT"
    return {
        "engineVersion": "1.4.0",
        "split": {
            "ratio": request.inSampleRatio,
            "inSampleStart": in_sample_bars[0].tradeDate.isoformat(),
            "inSampleEnd": in_sample_bars[-1].tradeDate.isoformat(),
            "outSampleStart": out_sample_bars[0].tradeDate.isoformat(),
            "outSampleEnd": out_sample_bars[-1].tradeDate.isoformat(),
        },
        "inSample": {
            "metrics": in_metrics,
            "equityPoints": in_sample["equityPoints"],
            "trades": in_sample["trades"],
        },
        "outSample": {
            "metrics": out_metrics,
            "equityPoints": out_sample["equityPoints"],
            "trades": out_sample["trades"],
        },
        "walkForwardWindows": windows,
        "parameterSweep": sweep,
        "stressTest": stress,
        "regimeMetrics": _regime_metrics(request, full_result),
        "crossSymbolMetrics": cross_symbols,
        "warnings": warnings,
        "approvalCriteria": criteria,
        "robustnessScore": robustness_score,
        "recommendation": recommendation,
    }


def generate_latest_signal(request: SignalGenerationRequest) -> dict[str, Any]:
    parameters = validate_strategy_parameters(request.strategyType, request.parameters)
    bars = sorted(request.bars, key=lambda bar: bar.tradeDate)
    close = pd.Series([bar.adjustedClose for bar in bars], dtype="float64")
    action = "HOLD"
    reason = "当前交易日未产生新信号"
    if request.strategyType == "BuyAndHold" and request.currentQuantity <= 0:
        action, reason = "BUY", "模拟账户尚未持仓，生成买入并持有信号"
    elif request.strategyType == "MovingAverageCross":
        assert isinstance(parameters, MovingAverageCrossParameters)
        short = sma(close, int(parameters.shortPeriod))
        long = sma(close, int(parameters.longPeriod))
        if (
            len(close) >= 2
            and short.iloc[-1] > long.iloc[-1]
            and short.iloc[-2] <= long.iloc[-2]
            and request.currentQuantity <= 0
        ):
            action, reason = "BUY", "短期均线上穿长期均线"
        elif (
            len(close) >= 2
            and short.iloc[-1] < long.iloc[-1]
            and short.iloc[-2] >= long.iloc[-2]
            and request.currentQuantity > 0
        ):
            action, reason = "SELL", "短期均线下穿长期均线"
    elif request.strategyType == "RsiMeanReversion":
        assert isinstance(parameters, RsiMeanReversionParameters)
        oscillator = rsi(close, int(parameters.period))
        latest = float(oscillator.iloc[-1])
        if (
            not math.isnan(latest)
            and latest < float(parameters.buyThreshold)
            and request.currentQuantity <= 0
        ):
            action, reason = "BUY", "RSI 低于买入阈值"
        elif (
            not math.isnan(latest)
            and latest > float(parameters.sellThreshold)
            and request.currentQuantity > 0
        ):
            action, reason = "SELL", "RSI 高于卖出阈值"
    elif request.strategyType == "TimeSeriesMomentum":
        assert isinstance(parameters, TimeSeriesMomentumParameters)
        lookback = int(parameters.lookbackDays)
        if len(close) < lookback + 2:
            reason = f"至少需要 {lookback + 2} 根日线确认时间序列动量状态"
        else:
            positive = close.iloc[-1] > close.iloc[-1 - lookback]
            previous_positive = close.iloc[-2] > close.iloc[-2 - lookback]
            if positive and not previous_positive and request.currentQuantity <= 0:
                action, reason = "BUY", "回看期收益由非正转为正，进入长期动量状态"
            elif not positive and previous_positive and request.currentQuantity > 0:
                action, reason = "SELL", "回看期收益由正转为非正，退出长期动量状态"
    elif request.strategyType == "FundamentalLiquidityCrowding":
        assert isinstance(parameters, FundamentalLiquidityCrowdingParameters)
        frame = pd.DataFrame(
            {
                "symbol": [bar.symbol for bar in bars],
                "tradeDate": [bar.tradeDate for bar in bars],
                "close": [bar.adjustedClose for bar in bars],
                "volume": [bar.volume for bar in bars],
            },
        )
        frame["volume"] = frame["volume"].astype("float64")
        frame["close"] = frame["close"].astype("float64")
        state = three_layer_state(frame, request.evidence, parameters)
        safe_to_hold = bool(state["safeToHold"].iloc[-1])
        evidence_ready = bool(state["externalReady"].iloc[-1])
        if request.currentQuantity <= 0 and safe_to_hold:
            action, reason = "BUY", "三层证据满足开仓条件，且流动性与拥挤压力均未触发"
        elif request.currentQuantity > 0 and not safe_to_hold:
            action, reason = "SELL", "三层证据缺失、过期或越过风险阈值"
        elif parameters.dataMode == "REQUIRE_VERIFIED_REAL" and not evidence_ready:
            reason = "真实财报、盘口、融资条件或空头持仓证据不完整，禁止开仓"
    return {
        "engineVersion": "1.4.0",
        "action": action,
        "signalTradeDate": bars[-1].tradeDate.isoformat(),
        "referencePrice": bars[-1].adjustedClose,
        "requestedAmount": request.targetAmount,
        "reason": reason,
        "stopLossCondition": parameters.stopLossCondition,
        "exitCondition": parameters.exitCondition,
    }
