from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import time
import zipfile
from dataclasses import dataclass
from datetime import date
from itertools import product
from typing import Any, Literal, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import pandas as pd

from app.volatility_overlay_research import (
    TRADING_SLIPPAGE_RATE,
    _commission,
    load_local_market_data,
)

FINRA_MARGIN_URL = (
    "https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx"
)
ALFRED_GRAPH_URL = "https://alfred.stlouisfed.org/graph/alfredgraph.csv"
MINIMUM_RANK_HISTORY_MONTHS = 36
RISK_THRESHOLDS = (0.70, 0.80, 0.90)
DEFENSIVE_EXPOSURES = (0.0, 0.5)

AuditClass = Literal[
    "EXACT_FACTOR_RESEARCH",
    "DECLARED_PROXY_RESEARCH",
    "RISK_METRIC_ONLY",
    "DATA_GAP",
    "METHOD_ONLY",
    "CREATOR_CASE_ONLY",
]


@dataclass(frozen=True)
class AuditDecision:
    classification: AuditClass
    reason: str


FACTOR_AUDIT: dict[str, AuditDecision] = {
    "MARGIN_DEBT_MOM": AuditDecision(
        "EXACT_FACTOR_RESEARCH",
        "FINRA 公开月度融资借方余额；使用次月发布后的一月环比。",
    ),
    "M2_NDX_GAP": AuditDecision(
        "DECLARED_PROXY_RESEARCH",
        "作者未公开比较基期；只研究明确标注的 M2 同比减 QQQ 12 月收益代理。",
    ),
    "BUFFETT_INDICATOR": AuditDecision(
        "DECLARED_PROXY_RESEARCH",
        "作者未公开总市值口径；只研究美联储 Z.1 非金融企业股票负债/GDP 代理。",
    ),
    "TAIL_RISK_NOT_DIRECTION": AuditDecision(
        "RISK_METRIC_ONLY", "只能描述左尾，不能直接推导买卖方向。"
    ),
    "HIGH_PRESSURE_LEFT_TAIL_EXAMPLE": AuditDecision(
        "CREATOR_CASE_ONLY", "缺少样本、压力指数构造和复算数据。"
    ),
    "NORMALITY_ASSUMPTION_TAIL_RISK": AuditDecision(
        "RISK_METRIC_ONLY", "模型风险原则，不是带方向的交易因子。"
    ),
    "HEAVY_TAIL_DISTRIBUTION_MODEL_RISK": AuditDecision(
        "RISK_METRIC_ONLY", "模型风险原则，不是带方向的交易因子。"
    ),
    "DISPLAYED_LIQUIDITY_EXECUTION_GAP": AuditDecision(
        "DATA_GAP", "缺少历史逐笔订单生命周期和可执行深度数据。"
    ),
    "SPOOFING_CANCEL_EVENT_RISK": AuditDecision(
        "DATA_GAP", "缺少 MBO 新增、修改、撤单事件，且不能从撤单率推断操纵意图。"
    ),
    "MBO_ORDER_EVENT_DATA_REQUIREMENT": AuditDecision(
        "DATA_GAP", "这是数据要求本身；项目没有历史 MBO 数据。"
    ),
    "NEGATIVE_GAMMA_HEDGING_FEEDBACK": AuditDecision(
        "DATA_GAP", "缺少可复算的历史净 Gamma 暴露和做市商头寸。"
    ),
    "DEALER_GAMMA_STATE": AuditDecision(
        "DATA_GAP", "作者没有公开净 Gamma 序列或完整计算口径。"
    ),
    "SPX_0DTE_SHARE": AuditDecision(
        "DATA_GAP", "Cboe 单点可核验，但没有覆盖20年的同口径历史序列。"
    ),
    "TOP10_CONCENTRATION": AuditDecision(
        "DATA_GAP", "缺少无幸存者偏差的历史成分、自由流通权重和指数口径。"
    ),
    "FORWARD_PE": AuditDecision(
        "DATA_GAP", "缺少当时可见的历史一致预期盈利数据库和指数口径。"
    ),
    "LEVERAGE_RATIO": AuditDecision(
        "DATA_GAP", "作者未披露精确分子、分母和发布日期。"
    ),
    "PRESSURE_THREE_INPUT_FRAMEWORK": AuditDecision(
        "DATA_GAP", "没有公开银行流动性序列、窗口和联合触发阈值。"
    ),
    "NDX_TREND_RECLAIM": AuditDecision(
        "DATA_GAP", "作者没有披露趋势算法和参数；不把标准均线冒充作者因子。"
    ),
    "TREASURY_BASIS_LEVERAGE_RISK": AuditDecision(
        "METHOD_ONLY", "市场结构风险机制，没有公开的 QQQ 方向规则。"
    ),
    "GROSS_SETTLEMENT_LIQUIDITY_RISK": AuditDecision(
        "METHOD_ONLY", "结算流动性机制，没有公开的 QQQ 方向规则。"
    ),
    "CARRY_TRADE_MULTI_LEG_RISK": AuditDecision(
        "METHOD_ONLY", "多腿去杠杆机制，没有公开的 QQQ 方向规则。"
    ),
    "MARGIN_CALL_LIQUIDITY_AMPLIFICATION": AuditDecision(
        "METHOD_ONLY", "保证金放大机制，不等于可复算交易条件。"
    ),
    "THREE_LAYER_DIRECTION": AuditDecision(
        "METHOD_ONLY", "框架描述，缺少可复算基本面定义。"
    ),
    "THREE_LAYER_LIQUIDITY": AuditDecision(
        "METHOD_ONLY", "框架描述，缺少可复算流动性定义。"
    ),
    "THREE_LAYER_CROWDING": AuditDecision(
        "METHOD_ONLY", "框架描述，缺少可复算拥挤定义。"
    ),
    "BACKTEST_DATA_INTEGRITY": AuditDecision(
        "METHOD_ONLY", "回测治理要求，不是预测因子。"
    ),
    "DYNAMIC_MULTI_FACTOR_STACK": AuditDecision(
        "DATA_GAP", "未公开具体因子、权重、再训练窗口和参数。"
    ),
    "EXPLAINABLE_QUANT_LOGIC": AuditDecision(
        "METHOD_ONLY", "模型治理原则，不是预测因子。"
    ),
    "STREAMING_FACTOR_RECOMPUTE": AuditDecision(
        "METHOD_ONLY", "数据管线方法，不是预测因子。"
    ),
    "BID_ASK_SPREAD_COST": AuditDecision(
        "RISK_METRIC_ONLY", "属于执行成本；回测已用保守滑点而非标题示例值。"
    ),
    "BID_ASK_SPREAD_TRANSACTION_COST": AuditDecision(
        "RISK_METRIC_ONLY", "属于执行成本；回测已用保守滑点。"
    ),
    "HFT_LATENCY_BOUNDARY": AuditDecision(
        "CREATOR_CASE_ONLY", "示例延迟不是日线 QQQ 策略因子。"
    ),
    "COINTEGRATION_HEDGE_RATIO": AuditDecision(
        "CREATOR_CASE_ONLY", "没有指定配对标的和可复算协整区间。"
    ),
    "PAIR_SPREAD_Z_SCORE": AuditDecision(
        "METHOD_ONLY", "标准化方法，没有指定配对标的和参数。"
    ),
    "POSITIVE_EXPECTANCY_EXAMPLE": AuditDecision(
        "CREATOR_CASE_ONLY", "作者算术示例，不是 QQQ 预测因子。"
    ),
    "GME_2021_SQUEEZE_MOVE": AuditDecision(
        "CREATOR_CASE_ONLY", "单一历史案例，不能外推为 QQQ 规则。"
    ),
    "AUGUST_PEAK_PROBABILITY": AuditDecision(
        "CREATOR_CASE_ONLY", "作者预测且缺少可复算模型。"
    ),
    "NDX_SECOND_WAVE_ZONE": AuditDecision(
        "CREATOR_CASE_ONLY", "作者情景区间，不作为系统阈值。"
    ),
    "NDX_CEILING_FORECAST": AuditDecision(
        "CREATOR_CASE_ONLY", "作者预测，不作为系统阈值。"
    ),
}

FeatureName = Literal[
    "marginDebtMomStress",
    "m2NdxGapStress",
    "buffettProxyStress",
    "compositeStress",
]


@dataclass(frozen=True)
class ResearchRule:
    feature: FeatureName
    risk_threshold: float
    defensive_exposure: float

    def __post_init__(self) -> None:
        if self.risk_threshold not in RISK_THRESHOLDS:
            raise ValueError("risk_threshold 不在预先声明网格")
        if self.defensive_exposure not in DEFENSIVE_EXPOSURES:
            raise ValueError("defensive_exposure 不在预先声明网格")


def audit_factors(sources: list[dict[str, Any]]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    missing_codes: set[str] = set()
    for source in sources:
        for factor in source.get("factors", []):
            code = str(factor["code"])
            decision = FACTOR_AUDIT.get(code)
            if decision is None:
                missing_codes.add(code)
                continue
            rows.append(
                {
                    "externalId": source.get("externalId"),
                    "code": code,
                    "verificationStatus": factor.get("verificationStatus"),
                    "classification": decision.classification,
                    "reason": decision.reason,
                }
            )
    if missing_codes:
        raise ValueError(f"存在未审计因子代码：{sorted(missing_codes)}")
    counts: dict[str, int] = {}
    for row in rows:
        key = str(row["classification"])
        counts[key] = counts.get(key, 0) + 1
    return {"factorRows": len(rows), "classificationCounts": counts, "rows": rows}


def _cell_text(cell: ElementTree.Element, namespace: dict[str, str]) -> str | None:
    inline = cell.find("main:is/main:t", namespace)
    if inline is not None:
        return inline.text
    value = cell.find("main:v", namespace)
    return value.text if value is not None else None


def parse_finra_margin_xlsx(content: bytes) -> pd.DataFrame:
    """Parse FINRA's simple XLSX without adding an Excel dependency."""

    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        root = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    namespace = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    records: list[dict[str, Any]] = []
    for row in root.findall(".//main:sheetData/main:row", namespace):
        cells: dict[str, str] = {}
        for cell in row.findall("main:c", namespace):
            reference = cell.attrib.get("r", "")
            column = re.sub(r"\d", "", reference)
            value = _cell_text(cell, namespace)
            if value is not None:
                cells[column] = value
        observed = cells.get("A")
        debit = cells.get("B")
        if not observed or not debit or observed == "Year-Month":
            continue
        observation_date = pd.Timestamp(f"{observed}-01") + pd.offsets.MonthEnd(0)
        records.append(
            {
                "observationDate": observation_date,
                "availableAt": observation_date + pd.Timedelta(days=25),
                "marginDebtMillions": float(debit),
            }
        )
    if not records:
        raise ValueError("FINRA XLSX 没有可用融资余额")
    frame = pd.DataFrame(records).sort_values("observationDate")
    frame["marginDebtMom"] = frame["marginDebtMillions"].pct_change()
    return frame.set_index("availableAt")


def load_finra_margin() -> pd.DataFrame:
    request = Request(FINRA_MARGIN_URL, headers={"User-Agent": "XichuQuant research/1.0"})
    return parse_finra_margin_xlsx(_read_official_url(request, timeout=30))


def _read_official_url(request: Request, *, timeout: int, attempts: int = 4) -> bytes:
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed URL
                return cast(bytes, response.read())
        except HTTPError as error:
            if error.code < 500 or attempt == attempts - 1:
                raise
        except (TimeoutError, URLError):
            if attempt == attempts - 1:
                raise
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError("官方数据请求重试状态无效")


def load_alfred_vintages(
    series_id: str, vintage_dates: list[pd.Timestamp], *, batch_size: int = 12
) -> dict[pd.Timestamp, pd.Series]:
    """Load values as they were visible on each requested historical date."""

    output: dict[pd.Timestamp, pd.Series] = {}
    normalized = [pd.Timestamp(item).normalize() for item in vintage_dates]
    for offset in range(0, len(normalized), batch_size):
        batch = normalized[offset : offset + batch_size]
        query = urlencode(
            {
                "id": ",".join(series_id for _ in batch),
                "vintage_date": ",".join(item.date().isoformat() for item in batch),
            }
        )
        request = Request(
            f"{ALFRED_GRAPH_URL}?{query}", headers={"User-Agent": "XichuQuant research/1.0"}
        )
        content = _read_official_url(request, timeout=60)
        csv_contents: list[str] = []
        if content.startswith(b"PK"):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                csv_contents = [
                    archive.read(name).decode("utf-8")
                    for name in archive.namelist()
                    if name.lower().endswith(".csv")
                ]
        else:
            csv_contents = [content.decode("utf-8")]
        columns: dict[pd.Timestamp, dict[pd.Timestamp, float]] = {}
        for csv_content in csv_contents:
            rows = list(csv.DictReader(io.StringIO(csv_content)))
            for row in rows:
                observed = row.get("observation_date", "")
                if not observed:
                    continue
                for field, raw in row.items():
                    match = re.search(r"_(\d{8})$", field)
                    if match is None or raw in {"", ".", None}:
                        continue
                    vintage = pd.Timestamp(match.group(1))
                    columns.setdefault(vintage, {})[pd.Timestamp(observed)] = float(
                        cast(str, raw)
                    )
        if not columns:
            raise ValueError(f"ALFRED {series_id} 没有返回数据")
        if len(columns) != len(batch):
            raise ValueError(
                f"ALFRED {series_id} vintage 列数量不匹配："
                f"请求 {len(batch)}，返回 {len(columns)}"
            )
        for requested_date in batch:
            values = columns.get(requested_date, {})
            if not values:
                raise ValueError(f"ALFRED {series_id} 在 {requested_date.date()} 无历史值")
            output[requested_date] = pd.Series(values, dtype="float64").sort_index()
    return output


def _last_trading_day_each_month(index: pd.DatetimeIndex) -> list[pd.Timestamp]:
    values = pd.Series(index=index, data=index)
    return [pd.Timestamp(item) for item in values.groupby(index.to_period("M")).last()]


def merge_market_cap_vintages(
    signal_dates: list[pd.Timestamp],
    legacy: dict[pd.Timestamp, pd.Series],
    successor: dict[pd.Timestamp, pd.Series],
) -> dict[pd.Timestamp, pd.Series]:
    """Prefer the successor Z.1 series after it became historically available."""

    empty = pd.Series(dtype="float64")
    return {
        signal_date: successor.get(signal_date, legacy.get(signal_date, empty))
        for signal_date in signal_dates
    }


def _one_year_change(values: pd.Series) -> float | None:
    values = values.dropna().sort_index()
    if values.empty:
        return None
    latest_date = pd.Timestamp(values.index[-1])
    previous = values.loc[values.index <= latest_date - pd.DateOffset(years=1)]
    if previous.empty or float(previous.iloc[-1]) == 0:
        return None
    return float(values.iloc[-1] / previous.iloc[-1] - 1)


def build_factor_snapshots(
    market: pd.DataFrame,
    finra: pd.DataFrame,
    m2_vintages: dict[pd.Timestamp, pd.Series],
    market_cap_vintages: dict[pd.Timestamp, pd.Series],
    gdp_vintages: dict[pd.Timestamp, pd.Series],
) -> pd.DataFrame:
    close = cast(pd.Series, market["adjustedClose"].astype("float64").sort_index())
    market_index = cast(pd.DatetimeIndex, close.index)
    signal_dates = _last_trading_day_each_month(market_index)
    records: list[dict[str, Any]] = []
    for signal_date in signal_dates:
        known_margin = finra.loc[finra.index <= signal_date]
        margin_mom = (
            float(known_margin.iloc[-1]["marginDebtMom"]) if not known_margin.empty else math.nan
        )

        m2 = m2_vintages[signal_date]
        m2_yoy = _one_year_change(m2)
        previous_qqq = close.loc[close.index <= signal_date - pd.DateOffset(years=1)]
        qqq_yoy = (
            float(close.loc[signal_date] / previous_qqq.iloc[-1] - 1)
            if not previous_qqq.empty
            else None
        )
        m2_gap = m2_yoy - qqq_yoy if m2_yoy is not None and qqq_yoy is not None else math.nan

        market_cap = market_cap_vintages[signal_date]
        gdp = gdp_vintages[signal_date]
        common_dates = market_cap.index.intersection(gdp.index)
        if len(common_dates) > 0:
            common_date = pd.Timestamp(common_dates[-1])
            market_cap_billions = float(market_cap.loc[common_date])
            # The successor Z.1 series changed from billions to millions in 2026.
            if market_cap_billions > 1_000_000:
                market_cap_billions /= 1_000
            # GDP is a seasonally adjusted annual rate in billions of dollars.
            buffett_proxy = market_cap_billions / float(gdp.loc[common_date]) * 100
        else:
            buffett_proxy = math.nan
        records.append(
            {
                "signalDate": signal_date,
                "marginDebtMom": margin_mom,
                "m2NdxGap12mProxy": m2_gap,
                "buffettZ1Proxy": buffett_proxy,
            }
        )
    frame = pd.DataFrame(records).set_index("signalDate").sort_index()
    frame["marginDebtMomStress"] = causal_percentile(frame["marginDebtMom"])
    frame["m2NdxGapStress"] = causal_percentile(-frame["m2NdxGap12mProxy"])
    frame["buffettProxyStress"] = causal_percentile(frame["buffettZ1Proxy"])
    frame["compositeStress"] = frame[
        ["marginDebtMomStress", "m2NdxGapStress", "buffettProxyStress"]
    ].mean(axis=1, skipna=False)
    return frame


def causal_percentile(
    values: pd.Series, minimum_history: int = MINIMUM_RANK_HISTORY_MONTHS
) -> pd.Series:
    """Rank each observation against prior observations only."""

    numeric = values.astype("float64")
    ranks: list[float] = []
    for index, current in enumerate(numeric):
        prior = numeric.iloc[:index].dropna()
        if pd.isna(current) or len(prior) < minimum_history:
            ranks.append(math.nan)
            continue
        lower = float((prior < current).sum())
        equal = float((prior == current).sum())
        ranks.append((lower + 0.5 * equal) / len(prior))
    return pd.Series(ranks, index=numeric.index, dtype="float64")


def _affordable_quantity(cash: float, execution_price: float) -> int:
    quantity = max(0, math.floor(cash / execution_price))
    while quantity > 0:
        notional = quantity * execution_price
        if notional + _commission(quantity, notional) <= cash:
            return quantity
        quantity -= 1
    return 0


def simulate_monthly_policy(
    market: pd.DataFrame,
    targets: pd.Series,
    evaluation_start: date,
    evaluation_end: date,
    *,
    initial_capital: float = 100_000,
) -> dict[str, float | int]:
    frame = market.sort_index()
    frame_index = cast(pd.DatetimeIndex, frame.index)
    evaluation = frame.loc[
        (frame_index.date >= evaluation_start) & (frame_index.date <= evaluation_end)
    ]
    if len(evaluation) < 2:
        raise ValueError("评估区间行情不足")

    execution_targets: dict[pd.Timestamp, float] = {}
    for signal_date, target in targets.dropna().sort_index().items():
        timestamp = pd.Timestamp(cast(Any, signal_date))
        later_dates = frame_index[frame_index > timestamp]
        if len(later_dates) > 0:
            execution_targets[pd.Timestamp(later_dates[0])] = float(target)

    first_date = pd.Timestamp(evaluation.index[0])
    known_targets = targets.loc[targets.index < first_date].dropna()
    current_target = float(known_targets.iloc[-1]) if not known_targets.empty else 1.0
    cash = initial_capital
    quantity = 0
    executions = 0
    total_commission = 0.0
    total_slippage = 0.0
    equity_values: list[float] = []
    exposure_values: list[float] = []
    dates: list[pd.Timestamp] = []

    for local_index, (timestamp_value, row) in enumerate(evaluation.iterrows()):
        timestamp = pd.Timestamp(cast(Any, timestamp_value))
        rebalance = local_index == 0
        if timestamp in execution_targets:
            new_target = execution_targets[timestamp]
            rebalance = rebalance or not math.isclose(new_target, current_target)
            current_target = new_target
        adjusted_open = float(row["adjustedOpen"])
        adjusted_close = float(row["adjustedClose"])
        if rebalance:
            equity_at_open = cash + quantity * adjusted_open
            desired = math.floor(equity_at_open * current_target / adjusted_open)
            delta = desired - quantity
            if delta < 0:
                traded = -delta
                execution_price = adjusted_open * (1 - TRADING_SLIPPAGE_RATE)
                notional = traded * execution_price
                commission = _commission(traded, notional)
                cash += notional - commission
                quantity -= traded
                total_commission += commission
                total_slippage += traded * adjusted_open * TRADING_SLIPPAGE_RATE
                executions += 1
            elif delta > 0:
                execution_price = adjusted_open * (1 + TRADING_SLIPPAGE_RATE)
                affordable = _affordable_quantity(cash, execution_price)
                traded = min(delta, affordable)
                if traded > 0:
                    notional = traded * execution_price
                    commission = _commission(traded, notional)
                    cash -= notional + commission
                    quantity += traded
                    total_commission += commission
                    total_slippage += traded * adjusted_open * TRADING_SLIPPAGE_RATE
                    executions += 1
        equity = cash + quantity * adjusted_close
        if equity <= 0:
            raise ValueError("策略权益已归零")
        dates.append(timestamp)
        equity_values.append(equity)
        exposure_values.append(quantity * adjusted_close / equity)

    equity_series = pd.Series(equity_values, index=pd.DatetimeIndex(dates), dtype="float64")
    exposure_series = pd.Series(
        exposure_values, index=pd.DatetimeIndex(dates), dtype="float64"
    )
    returns = equity_series.pct_change().dropna()
    elapsed_years = (equity_series.index[-1] - equity_series.index[0]).days / 365.25
    total_return = equity_series.iloc[-1] / initial_capital - 1
    cagr = (equity_series.iloc[-1] / initial_capital) ** (1 / elapsed_years) - 1
    drawdown = equity_series / equity_series.cummax() - 1
    standard_deviation = float(returns.std(ddof=1))
    sharpe = (
        float(returns.mean() / standard_deviation * math.sqrt(252))
        if standard_deviation > 0
        else 0.0
    )
    return {
        "finalEquity": round(float(equity_series.iloc[-1]), 2),
        "totalReturn": round(float(total_return * 100), 6),
        "cagr": round(float(cagr * 100), 6),
        "maxDrawdown": round(float(drawdown.min() * 100), 6),
        "sharpeRatio": round(sharpe, 6),
        "averageExposure": round(float(exposure_series.mean() * 100), 6),
        "executionCount": executions,
        "totalCommission": round(total_commission, 4),
        "totalSlippage": round(total_slippage, 4),
    }


def _rule_targets(snapshots: pd.DataFrame, rule: ResearchRule) -> pd.Series:
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


def _benchmark_targets(snapshots: pd.DataFrame) -> pd.Series:
    return pd.Series(1.0, index=snapshots.index, dtype="float64")


def factor_diagnostics(
    snapshots: pd.DataFrame, market: pd.DataFrame, periods: dict[str, tuple[date, date]]
) -> dict[str, Any]:
    close = cast(pd.Series, market["adjustedClose"].astype("float64").sort_index())
    close_index = cast(pd.DatetimeIndex, close.index)
    output: dict[str, Any] = {}
    for feature in (
        "marginDebtMomStress",
        "m2NdxGapStress",
        "buffettProxyStress",
        "compositeStress",
    ):
        output[feature] = {}
        for period_name, (start, end) in periods.items():
            pairs: list[dict[str, float]] = []
            for signal_date, stress in snapshots[feature].dropna().items():
                timestamp = pd.Timestamp(cast(Any, signal_date))
                if not start <= timestamp.date() <= end:
                    continue
                location = int(close_index.searchsorted(timestamp))
                future_location = location + 63
                if location >= len(close) or future_location >= len(close):
                    continue
                forward_return = float(close.iloc[future_location] / close.iloc[location] - 1)
                pairs.append({"stress": float(stress), "forwardReturn63d": forward_return})
            frame = pd.DataFrame(pairs)
            if len(frame) < 3:
                output[feature][period_name] = {"observations": len(frame)}
                continue
            high = frame.loc[frame["stress"] >= 0.8, "forwardReturn63d"]
            normal = frame.loc[frame["stress"] < 0.8, "forwardReturn63d"]
            ranked_stress = frame["stress"].rank(method="average")
            ranked_return = frame["forwardReturn63d"].rank(method="average")
            output[feature][period_name] = {
                "observations": len(frame),
                "spearmanStressVsForwardReturn63d": round(
                    float(ranked_stress.corr(ranked_return)),
                    6,
                ),
                "highStressMeanForwardReturn63dPercent": (
                    round(float(high.mean() * 100), 6) if not high.empty else None
                ),
                "otherMeanForwardReturn63dPercent": (
                    round(float(normal.mean() * 100), 6) if not normal.empty else None
                ),
            }
    return output


def compare_research_rules(
    market: pd.DataFrame,
    snapshots: pd.DataFrame,
    periods: dict[str, tuple[date, date]],
) -> dict[str, Any]:
    rules = [
        ResearchRule(cast(FeatureName, feature), threshold, defensive)
        for feature, threshold, defensive in product(
            (
                "marginDebtMomStress",
                "m2NdxGapStress",
                "buffettProxyStress",
                "compositeStress",
            ),
            RISK_THRESHOLDS,
            DEFENSIVE_EXPOSURES,
        )
    ]
    development_start, development_end = periods["development"]
    development_results: list[tuple[ResearchRule, dict[str, float | int]]] = []
    for rule in rules:
        metrics = simulate_monthly_policy(
            market,
            _rule_targets(snapshots, rule),
            development_start,
            development_end,
        )
        development_results.append((rule, metrics))
    development_results.sort(
        key=lambda item: (float(item[1]["totalReturn"]), float(item[1]["maxDrawdown"])),
        reverse=True,
    )
    selected = development_results[0][0]
    benchmark_targets = _benchmark_targets(snapshots)
    period_results: dict[str, Any] = {}
    for name, (start, end) in periods.items():
        period_results[name] = {
            "qqqBuyHold100": simulate_monthly_policy(
                market, benchmark_targets, start, end
            ),
            "selectedResearchRule": simulate_monthly_policy(
                market, _rule_targets(snapshots, selected), start, end
            ),
        }

    sensitivity = {
        "candidateCount": len(rules),
        "validationReturnWinners": 0,
        "heldOutReturnWinners": 0,
        "bothOutOfSampleReturnWinners": 0,
        "bothOutOfSampleReturnAndDrawdownWinners": 0,
    }
    validation_benchmark = period_results["validation"]["qqqBuyHold100"]
    held_out_benchmark = period_results["heldOut"]["qqqBuyHold100"]
    for rule in rules:
        validation = simulate_monthly_policy(
            market, _rule_targets(snapshots, rule), *periods["validation"]
        )
        held_out = simulate_monthly_policy(
            market, _rule_targets(snapshots, rule), *periods["heldOut"]
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

    selected_validation = period_results["validation"]["selectedResearchRule"]
    selected_held_out = period_results["heldOut"]["selectedResearchRule"]
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
            "features": [
                "FINRA 月度融资余额环比",
                "ALFRED 当时版本 M2 同比减 QQQ 12 月收益代理",
                "ALFRED 当时版本 Z.1 非金融企业股票负债/GDP 代理",
                "三项因果百分位等权平均",
            ],
            "riskThresholdGrid": list(RISK_THRESHOLDS),
            "defensiveExposureGrid": list(DEFENSIVE_EXPOSURES),
            "selection": "仅按 development 总收益选择一次，validation/heldOut 冻结",
            "execution": "月末收盘后形成状态，下一交易日开盘执行",
            "costs": "IBKR Pro 基础佣金代理 + 单边0.05%滑点；现金不计息",
            "authorParameterClaim": False,
        },
        "selected": {
            "feature": selected.feature,
            "riskThreshold": selected.risk_threshold,
            "defensiveExposure": selected.defensive_exposure,
        },
        "periods": period_results,
        "sensitivity": sensitivity,
        "selectedPassesPerformanceGate": selected_passes,
        "eligibleForSystemIntegration": False,
        "integrationBlockers": [
            "M2 缺口和巴菲特指标是明确标注的代理口径，不是作者未公开的原始公式",
            "FINRA 历史下载没有逐月 vintage 档案，无法排除后来报送修订",
            "研究网格是独立稳健性检验，不是作者公开参数",
        ],
    }


def _fetch_json(url: str) -> Any:
    with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed local endpoint
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="公开视频因子对 QQQ 的历史研究")
    parser.add_argument("--api-base", default="http://localhost:5089")
    parser.add_argument("--source", default="CSV_IMPORT")
    args = parser.parse_args()

    market = load_local_market_data(args.api_base, "QQQ", args.source)
    market_index = cast(pd.DatetimeIndex, market.index)
    signal_dates = _last_trading_day_each_month(market_index)
    finra = load_finra_margin()
    m2 = load_alfred_vintages("M2SL", signal_dates)
    legacy_market_cap_dates = [item for item in signal_dates if item >= pd.Timestamp("2010-06-01")]
    successor_market_cap_dates = [
        item for item in signal_dates if item >= pd.Timestamp("2015-06-01")
    ]
    legacy_market_cap = load_alfred_vintages(
        "MVEONWMVBSNNCB", legacy_market_cap_dates
    )
    successor_market_cap = load_alfred_vintages("NCBCEL", successor_market_cap_dates)
    market_cap = merge_market_cap_vintages(
        signal_dates, legacy_market_cap, successor_market_cap
    )
    gdp = load_alfred_vintages("GDP", signal_dates)
    snapshots = build_factor_snapshots(market, finra, m2, market_cap, gdp)
    dashboard = _fetch_json(f"{args.api_base.rstrip('/')}/market-research/dashboard")
    periods = {
        "development": (date(2006, 8, 21), date(2014, 12, 31)),
        "validation": (date(2015, 1, 2), date(2020, 12, 31)),
        "heldOut": (date(2021, 1, 4), date(2026, 8, 21)),
        "full": (date(2006, 8, 21), date(2026, 8, 21)),
    }
    output = {
        "audit": audit_factors(dashboard["sources"]),
        "data": {
            "firstQqqDate": market_index[0].date().isoformat(),
            "lastQqqDate": market_index[-1].date().isoformat(),
            "monthlySnapshots": len(snapshots),
            "officialSources": {
                "marginDebt": FINRA_MARGIN_URL,
                "m2": "https://fred.stlouisfed.org/series/M2SL",
                "marketCapLegacy": "https://fred.stlouisfed.org/series/MVEONWMVBSNNCB",
                "marketCapSuccessor": "https://fred.stlouisfed.org/series/NCBCEL",
                "gdp": "https://fred.stlouisfed.org/series/GDP",
            },
        },
        "diagnostics": factor_diagnostics(snapshots, market, periods),
        "backtest": compare_research_rules(market, snapshots, periods),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
