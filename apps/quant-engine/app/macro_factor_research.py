from __future__ import annotations

import argparse
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from itertools import product
from typing import Any, Literal, cast

import pandas as pd

from app.creator_factor_research import (
    DEFENSIVE_EXPOSURES,
    RISK_THRESHOLDS,
    _last_trading_day_each_month,
    load_alfred_vintages,
    simulate_monthly_policy,
)
from app.tqqq_drawdown_research import load_yahoo_adjusted
from app.volatility_overlay_research import load_local_market_data

FIRST_COMMON_VINTAGE_DATE = pd.Timestamp("2014-03-18")
DOLLAR_SUCCESSOR_FIRST_RELEASE = pd.Timestamp("2019-02-04")
MINIMUM_REFERENCE_OBSERVATIONS = 756

FeatureName = Literal[
    "fedFundsStress",
    "broadDollarStress",
    "vixStress",
    "compositeStress",
]
SignalFrequency = Literal["monthly", "quarterly"]


@dataclass(frozen=True)
class MacroRiskRule:
    feature: FeatureName
    risk_threshold: float
    defensive_exposure: float

    def __post_init__(self) -> None:
        if self.risk_threshold not in RISK_THRESHOLDS:
            raise ValueError("risk_threshold 不在预先声明网格")
        if self.defensive_exposure not in DEFENSIVE_EXPOSURES:
            raise ValueError("defensive_exposure 不在预先声明网格")


def load_vintages_parallel(
    series_id: str, vintage_dates: list[pd.Timestamp], *, workers: int = 3
) -> dict[pd.Timestamp, pd.Series]:
    """Use ALFRED's 12-vintage response limit with bounded request concurrency."""

    if not vintage_dates:
        return {}
    batches = [vintage_dates[offset : offset + 12] for offset in range(0, len(vintage_dates), 12)]

    def fetch(batch: list[pd.Timestamp]) -> dict[pd.Timestamp, pd.Series]:
        return load_alfred_vintages(series_id, batch)

    output: dict[pd.Timestamp, pd.Series] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for result in executor.map(fetch, batches):
            output.update(result)
    return output


def one_year_changes(values: pd.Series, *, percentage: bool) -> pd.Series:
    """Calculate one-year changes using only observations already in one vintage."""

    numeric = values.dropna().astype("float64").sort_index()
    if numeric.empty:
        return pd.Series(dtype="float64")
    index = cast(pd.DatetimeIndex, numeric.index)
    positions = index.searchsorted(index - pd.DateOffset(years=1), side="right") - 1
    valid = positions >= 0
    current_dates = index[valid]
    all_values = numeric.to_numpy(dtype="float64")
    current_values = all_values[valid]
    previous_values = all_values[positions[valid]]
    if percentage:
        nonzero = previous_values != 0
        current_dates = current_dates[nonzero]
        current_values = current_values[nonzero]
        previous_values = previous_values[nonzero]
        changes = current_values / previous_values - 1
    else:
        changes = current_values - previous_values
    return pd.Series(changes, index=current_dates, dtype="float64")


def latest_causal_percentile(
    values: pd.Series, *, minimum_observations: int = MINIMUM_REFERENCE_OBSERVATIONS
) -> float:
    """Rank the latest value against prior values in the same as-of vintage."""

    numeric = values.dropna().astype("float64").sort_index()
    if len(numeric) <= minimum_observations:
        return math.nan
    current = float(numeric.iloc[-1])
    prior = numeric.iloc[:-1]
    if len(prior) < minimum_observations:
        return math.nan
    lower = float((prior < current).sum())
    equal = float((prior == current).sum())
    return (lower + 0.5 * equal) / len(prior)


def build_macro_snapshots(
    signal_dates: list[pd.Timestamp],
    dff_vintages: dict[pd.Timestamp, pd.Series],
    legacy_dollar_vintages: dict[pd.Timestamp, pd.Series],
    successor_dollar_vintages: dict[pd.Timestamp, pd.Series],
    vix_vintages: dict[pd.Timestamp, pd.Series],
) -> pd.DataFrame:
    records: list[dict[str, float | pd.Timestamp]] = []
    for signal_date in signal_dates:
        normalized = pd.Timestamp(signal_date).normalize()
        dff = dff_vintages[normalized]
        vix = vix_vintages[normalized]
        dollar = (
            successor_dollar_vintages[normalized]
            if normalized >= DOLLAR_SUCCESSOR_FIRST_RELEASE
            else legacy_dollar_vintages[normalized]
        )

        dff_change = one_year_changes(dff, percentage=False)
        dollar_change = one_year_changes(dollar, percentage=True)
        fed_stress = latest_causal_percentile(dff_change)
        dollar_stress = latest_causal_percentile(dollar_change)
        vix_stress = latest_causal_percentile(vix)
        components = [fed_stress, dollar_stress, vix_stress]
        composite = (
            float(sum(components) / len(components))
            if all(math.isfinite(value) for value in components)
            else math.nan
        )
        records.append(
            {
                "signalDate": normalized,
                "fedFunds12mChangePoints": (
                    float(dff_change.iloc[-1]) if not dff_change.empty else math.nan
                ),
                "broadDollar12mReturn": (
                    float(dollar_change.iloc[-1]) if not dollar_change.empty else math.nan
                ),
                "vixClose": float(vix.dropna().iloc[-1]),
                "fedFundsStress": fed_stress,
                "broadDollarStress": dollar_stress,
                "vixStress": vix_stress,
                "compositeStress": composite,
            }
        )
    if not records:
        raise ValueError("没有可用的宏观因子快照")
    return pd.DataFrame(records).set_index("signalDate").sort_index()


def rule_targets(snapshots: pd.DataFrame, rule: MacroRiskRule) -> pd.Series:
    stress = snapshots[rule.feature]
    return pd.Series(
        [
            math.nan
            if pd.isna(value)
            else rule.defensive_exposure
            if float(value) >= rule.risk_threshold
            else 1.0
            for value in stress
        ],
        index=snapshots.index,
        dtype="float64",
    )


def benchmark_targets(snapshots: pd.DataFrame) -> pd.Series:
    return pd.Series(1.0, index=snapshots.index, dtype="float64")


def last_trading_day_each_quarter(index: pd.DatetimeIndex) -> list[pd.Timestamp]:
    return [
        item for item in _last_trading_day_each_month(index) if item.month in {3, 6, 9, 12}
    ]


def factor_diagnostics(
    snapshots: pd.DataFrame,
    market: pd.DataFrame,
    periods: dict[str, tuple[date, date]],
) -> dict[str, Any]:
    close = cast(pd.Series, market["adjustedClose"].astype("float64").sort_index())
    close_index = cast(pd.DatetimeIndex, close.index)
    output: dict[str, Any] = {}
    for feature in cast(
        tuple[FeatureName, ...],
        ("fedFundsStress", "broadDollarStress", "vixStress", "compositeStress"),
    ):
        output[feature] = {}
        for period_name, (start, end) in periods.items():
            pairs: list[dict[str, float]] = []
            for signal_date, stress in snapshots[feature].dropna().items():
                timestamp = pd.Timestamp(cast(Any, signal_date))
                if not start <= timestamp.date() <= end:
                    continue
                location = int(close_index.searchsorted(timestamp, side="right") - 1)
                future_location = location + 63
                if location < 0 or future_location >= len(close):
                    continue
                pairs.append(
                    {
                        "stress": float(stress),
                        "forwardReturn63d": float(
                            close.iloc[future_location] / close.iloc[location] - 1
                        ),
                    }
                )
            frame = pd.DataFrame(pairs)
            if len(frame) < 3:
                output[feature][period_name] = {"observations": len(frame)}
                continue
            ranked_stress = frame["stress"].rank(method="average")
            ranked_return = frame["forwardReturn63d"].rank(method="average")
            high = frame.loc[frame["stress"] >= 0.8, "forwardReturn63d"]
            other = frame.loc[frame["stress"] < 0.8, "forwardReturn63d"]
            output[feature][period_name] = {
                "observations": len(frame),
                "spearmanStressVsForwardReturn63d": round(
                    float(ranked_stress.corr(ranked_return)), 6
                ),
                "highStressMeanForwardReturn63dPercent": (
                    round(float(high.mean() * 100), 6) if not high.empty else None
                ),
                "otherMeanForwardReturn63dPercent": (
                    round(float(other.mean() * 100), 6) if not other.empty else None
                ),
            }
    return output


def compare_macro_rules(
    market: pd.DataFrame,
    snapshots: pd.DataFrame,
    periods: dict[str, tuple[date, date]],
    *,
    signal_frequency: SignalFrequency,
    symbol: str,
) -> dict[str, Any]:
    features = cast(
        tuple[FeatureName, ...],
        ("fedFundsStress", "broadDollarStress", "vixStress", "compositeStress"),
    )
    rules = [
        MacroRiskRule(feature, threshold, defensive)
        for feature, threshold, defensive in product(
            features, RISK_THRESHOLDS, DEFENSIVE_EXPOSURES
        )
    ]
    development_start, development_end = periods["development"]
    development_results = [
        (
            rule,
            simulate_monthly_policy(
                market,
                rule_targets(snapshots, rule),
                development_start,
                development_end,
            ),
        )
        for rule in rules
    ]
    development_results.sort(
        key=lambda item: (float(item[1]["totalReturn"]), float(item[1]["maxDrawdown"])),
        reverse=True,
    )
    selected = development_results[0][0]
    buy_hold_targets = benchmark_targets(snapshots)
    period_results: dict[str, Any] = {}
    for name, (start, end) in periods.items():
        period_results[name] = {
            "buyHold100": simulate_monthly_policy(market, buy_hold_targets, start, end),
            "selectedMacroRule": simulate_monthly_policy(
                market, rule_targets(snapshots, selected), start, end
            ),
        }

    sensitivity = {
        "candidateCount": len(rules),
        "validationReturnWinners": 0,
        "heldOutReturnWinners": 0,
        "bothOutOfSampleReturnWinners": 0,
        "bothOutOfSampleReturnAndDrawdownWinners": 0,
    }
    validation_benchmark = period_results["validation"]["buyHold100"]
    held_out_benchmark = period_results["heldOut"]["buyHold100"]
    for rule in rules:
        validation = simulate_monthly_policy(
            market, rule_targets(snapshots, rule), *periods["validation"]
        )
        held_out = simulate_monthly_policy(
            market, rule_targets(snapshots, rule), *periods["heldOut"]
        )
        validation_wins = float(validation["totalReturn"]) > float(
            validation_benchmark["totalReturn"]
        )
        held_out_wins = float(held_out["totalReturn"]) > float(
            held_out_benchmark["totalReturn"]
        )
        sensitivity["validationReturnWinners"] += int(validation_wins)
        sensitivity["heldOutReturnWinners"] += int(held_out_wins)
        sensitivity["bothOutOfSampleReturnWinners"] += int(
            validation_wins and held_out_wins
        )
        protects_drawdown = float(validation["maxDrawdown"]) >= float(
            validation_benchmark["maxDrawdown"]
        ) and float(held_out["maxDrawdown"]) >= float(
            held_out_benchmark["maxDrawdown"]
        )
        sensitivity["bothOutOfSampleReturnAndDrawdownWinners"] += int(
            validation_wins and held_out_wins and protects_drawdown
        )

    selected_validation = period_results["validation"]["selectedMacroRule"]
    selected_held_out = period_results["heldOut"]["selectedMacroRule"]
    selected_passes = (
        float(selected_validation["totalReturn"])
        > float(validation_benchmark["totalReturn"])
        and float(selected_held_out["totalReturn"])
        > float(held_out_benchmark["totalReturn"])
        and float(selected_validation["maxDrawdown"])
        >= float(validation_benchmark["maxDrawdown"])
        and float(selected_held_out["maxDrawdown"])
        >= float(held_out_benchmark["maxDrawdown"])
    )
    return {
        "method": {
            "symbol": symbol,
            "features": [
                "ALFRED 当时版本 DFF 的12个月百分点变化因果百分位",
                "ALFRED 当时版本广义美元指数12个月涨幅因果百分位",
                "ALFRED 当时版本 VIX 收盘值因果百分位",
                "三项压力百分位等权平均",
            ],
            "dollarSeriesTransition": (
                "2019-02-04 前使用当时存在的 DTWEXB goods-only；之后使用首次公开的 "
                "DTWEXBGS goods-and-services；只比较各自12个月变化百分位"
            ),
            "riskThresholdGrid": list(RISK_THRESHOLDS),
            "defensiveExposureGrid": list(DEFENSIVE_EXPOSURES),
            "selection": "仅按 development 总收益选择一次，validation/heldOut 冻结",
            "execution": (
                "月末数据形成状态，下一交易日开盘执行"
                if signal_frequency == "monthly"
                else "季末数据形成状态，下一交易日开盘执行"
            ),
            "signalFrequency": signal_frequency,
            "costs": "IBKR Pro 基础佣金代理 + 单边0.05%滑点；现金不计息",
            "authorParameterClaim": False,
            "createsSignalOrOrder": False,
        },
        "selected": {
            "feature": selected.feature,
            "riskThreshold": selected.risk_threshold,
            "defensiveExposure": selected.defensive_exposure,
        },
        "periods": period_results,
        "diagnostics": factor_diagnostics(snapshots, market, periods),
        "sensitivity": sensitivity,
        "selectedPassesPerformanceGate": selected_passes,
        "eligibleForSystemIntegration": False,
        "integrationBlockers": [
            "三项共同无前视 ALFRED 历史只从2014-03开始，不能冒充20年认证样本",
            "24个预声明候选仍存在多重检验风险，必须看冻结验证集和留出集",
            f"宏观压力与{symbol}方向之间只是待检验假设，不足以直接生成订单",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="美股三项宏观因子无前视研究回测")
    parser.add_argument("--api-base", default="http://localhost:5089")
    parser.add_argument("--source", default="CSV_IMPORT")
    parser.add_argument("--symbols", default="QQQ")
    parser.add_argument("--market-source", choices=("local", "yahoo"), default="local")
    parser.add_argument("--frequency", choices=("monthly", "quarterly"), default="quarterly")
    args = parser.parse_args()

    symbols = list(dict.fromkeys(item.strip().upper() for item in args.symbols.split(",")))
    if not symbols or any(not re.fullmatch(r"[A-Z0-9.-]{1,32}", item) for item in symbols):
        raise ValueError("symbols 格式无效")
    markets = {
        symbol: (
            load_local_market_data(args.api_base, symbol, args.source)
            if args.market_source == "local"
            else load_yahoo_adjusted(symbol, date(2005, 1, 1), date(2026, 8, 21))
        )
        for symbol in symbols
    }
    common_index = cast(pd.DatetimeIndex, markets[symbols[0]].index)
    for market in list(markets.values())[1:]:
        common_index = common_index.intersection(cast(pd.DatetimeIndex, market.index))
    if common_index.empty:
        raise ValueError("标的之间没有共同交易日")
    all_signal_dates = (
        _last_trading_day_each_month(common_index)
        if args.frequency == "monthly"
        else last_trading_day_each_quarter(common_index)
    )
    signal_dates = [
        item
        for item in all_signal_dates
        if item >= FIRST_COMMON_VINTAGE_DATE
    ]
    legacy_dates = [
        item for item in signal_dates if item < DOLLAR_SUCCESSOR_FIRST_RELEASE
    ]
    successor_dates = [
        item for item in signal_dates if item >= DOLLAR_SUCCESSOR_FIRST_RELEASE
    ]
    dff = load_vintages_parallel("DFF", signal_dates)
    legacy_dollar = load_vintages_parallel("DTWEXB", legacy_dates)
    successor_dollar = load_vintages_parallel("DTWEXBGS", successor_dates)
    vix = load_vintages_parallel("VIXCLS", signal_dates)
    snapshots = build_macro_snapshots(
        signal_dates, dff, legacy_dollar, successor_dollar, vix
    )
    periods = {
        "development": (date(2014, 4, 1), date(2018, 12, 31)),
        "validation": (date(2019, 1, 2), date(2022, 12, 30)),
        "heldOut": (date(2023, 1, 3), date(2026, 8, 21)),
        "full": (date(2014, 4, 1), date(2026, 8, 21)),
    }
    results: dict[str, Any] = {}
    for symbol, market in markets.items():
        result = compare_macro_rules(
            market,
            snapshots,
            periods,
            signal_frequency=cast(SignalFrequency, args.frequency),
            symbol=symbol,
        )
        market_index = cast(pd.DatetimeIndex, market.index)
        result["data"] = {
            "firstMarketDate": market_index[0].date().isoformat(),
            "lastMarketDate": market_index[-1].date().isoformat(),
            "marketSource": args.market_source,
        }
        results[symbol] = result
    output = {
        "macroData": {
        "firstCertifiedSignalDate": snapshots.index[0].date().isoformat(),
        "lastCertifiedSignalDate": snapshots.index[-1].date().isoformat(),
        "signalFrequency": args.frequency,
        "signalSnapshots": len(snapshots),
        "pointInTimeSource": "ALFRED vintage_date",
        },
        "results": results,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
