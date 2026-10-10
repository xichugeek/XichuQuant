from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

StrategyType = Literal[
    "BuyAndHold",
    "MovingAverageCross",
    "RsiMeanReversion",
    "TimeSeriesMomentum",
    "MultiHorizonTrend",
    "DualMomentumRotation",
    "CoreSatelliteMomentum",
    "FundamentalLiquidityCrowding",
]

CommissionModel = Literal["PERCENT_NOTIONAL", "IBKR_US_EQUITY_TIERED_BASE"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MarketBar(StrictModel):
    symbol: str = Field(min_length=1, max_length=32)
    tradeDate: date
    open: Annotated[float, Field(gt=0)]
    high: Annotated[float, Field(gt=0)]
    low: Annotated[float, Field(gt=0)]
    close: Annotated[float, Field(gt=0)]
    adjustedClose: Annotated[float, Field(gt=0)]
    volume: Annotated[float, Field(ge=0)] = 0
    dividend: Annotated[float, Field(ge=0)] = 0
    splitFactor: Annotated[float, Field(gt=0)] = 1
    currency: str = "USD"
    source: str

    @model_validator(mode="after")
    def validate_ohlc(self) -> MarketBar:
        if self.high < self.low:
            raise ValueError("最高价不能低于最低价")
        if not self.low <= self.open <= self.high:
            raise ValueError("开盘价必须位于最高价和最低价之间")
        if not self.low <= self.close <= self.high:
            raise ValueError("收盘价必须位于最高价和最低价之间")
        return self


class BaseStrategyParameters(StrictModel):
    positionPercent: Annotated[float, Field(gt=0, le=100)] = 95
    stopLossCondition: str | None = None
    exitCondition: str | None = None


class BuyAndHoldParameters(BaseStrategyParameters):
    pass


class MovingAverageCrossParameters(BaseStrategyParameters):
    shortPeriod: Annotated[int, Field(gt=0)] = 20
    longPeriod: Annotated[int, Field(gt=1)] = 60

    @model_validator(mode="after")
    def validate_periods(self) -> MovingAverageCrossParameters:
        if self.longPeriod <= self.shortPeriod:
            raise ValueError("longPeriod 必须大于 shortPeriod")
        return self


class RsiMeanReversionParameters(BaseStrategyParameters):
    period: Annotated[int, Field(gt=1)] = 14
    buyThreshold: Annotated[float, Field(gt=0, lt=100)] = 30
    sellThreshold: Annotated[float, Field(gt=0, lt=100)] = 70
    minimumHoldingDays: Annotated[int, Field(ge=0, le=252)] = 0

    @model_validator(mode="after")
    def validate_thresholds(self) -> RsiMeanReversionParameters:
        if self.sellThreshold <= self.buyThreshold:
            raise ValueError("sellThreshold 必须大于 buyThreshold")
        return self


class TimeSeriesMomentumParameters(BaseStrategyParameters):
    """Long/cash time-series momentum adapted from an MIT-licensed implementation.

    Source methodology and candidate grid:
    https://github.com/bonnie-mcconnell/backtesting-engine
    """

    lookbackDays: Annotated[int, Field(ge=20, le=504)] = 120


class MultiHorizonTrendParameters(BaseStrategyParameters):
    """Long/cash ensemble of independently observed trend horizons."""

    symbol: str = Field(default="QQQ", pattern=r"^[A-Z0-9.-]{1,32}$")
    lookbackDays: list[Annotated[int, Field(ge=20, le=504)]] = Field(
        default_factory=lambda: [21, 63, 126, 252], min_length=2, max_length=8
    )
    minimumPositiveHorizons: Annotated[int, Field(ge=1, le=8)] = 3

    @model_validator(mode="after")
    def validate_horizons(self) -> MultiHorizonTrendParameters:
        if len(self.lookbackDays) != len(set(self.lookbackDays)):
            raise ValueError("lookbackDays 不能重复")
        if self.minimumPositiveHorizons > len(self.lookbackDays):
            raise ValueError("minimumPositiveHorizons 不能超过趋势周期数量")
        return self


class DualMomentumRotationParameters(BaseStrategyParameters):
    """Monthly relative momentum with a defensive absolute-momentum hurdle."""

    riskAssets: list[str] = Field(min_length=2, max_length=20)
    defensiveAsset: str = Field(pattern=r"^[A-Z0-9.-]{1,32}$")
    benchmarkSymbol: str = Field(default="QQQ", pattern=r"^[A-Z0-9.-]{1,32}$")
    lookbackDays: Annotated[int, Field(ge=20, le=504)] = 252

    @model_validator(mode="after")
    def validate_universe(self) -> DualMomentumRotationParameters:
        if len(self.riskAssets) != len(set(self.riskAssets)):
            raise ValueError("riskAssets 不能重复")
        if self.defensiveAsset in self.riskAssets:
            raise ValueError("defensiveAsset 不能同时属于 riskAssets")
        return self


class CoreSatelliteMomentumParameters(BaseStrategyParameters):
    """Permanent core exposure with a monthly relative-momentum satellite sleeve."""

    coreSymbol: str = Field(default="QQQ", pattern=r"^[A-Z0-9.-]{1,32}$")
    corePercent: Annotated[float, Field(gt=0, lt=100)] = 70
    satelliteAssets: list[str] = Field(min_length=1, max_length=20)
    defensiveAsset: str = Field(pattern=r"^[A-Z0-9.-]{1,32}$")
    benchmarkSymbol: str = Field(default="QQQ", pattern=r"^[A-Z0-9.-]{1,32}$")
    lookbackDays: Annotated[int, Field(ge=20, le=504)] = 252

    @model_validator(mode="after")
    def validate_universe(self) -> CoreSatelliteMomentumParameters:
        if len(self.satelliteAssets) != len(set(self.satelliteAssets)):
            raise ValueError("satelliteAssets 不能重复")
        if self.coreSymbol in self.satelliteAssets:
            raise ValueError("coreSymbol 不能同时属于 satelliteAssets")
        if self.defensiveAsset in self.satelliteAssets or self.defensiveAsset == self.coreSymbol:
            raise ValueError("defensiveAsset 必须独立于核心和卫星风险资产")
        if self.corePercent >= self.positionPercent:
            raise ValueError("corePercent 必须小于 positionPercent")
        return self


class StrategyEvidenceObservation(StrictModel):
    symbol: str = Field(min_length=1, max_length=32)
    metricCode: Literal[
        "FUNDAMENTAL_GROWTH_SCORE",
        "ORDER_BOOK_IMBALANCE",
        "FINANCIAL_CONDITIONS_Z",
        "SHORT_INTEREST_PERCENT",
        "DAYS_TO_COVER",
    ]
    value: float
    observedAt: datetime
    availableAt: datetime
    expiresAt: datetime | None = None
    source: str = Field(min_length=1, max_length=64)
    verificationStatus: Literal["VERIFIED"]

    @model_validator(mode="after")
    def validate_timeline(self) -> StrategyEvidenceObservation:
        if self.availableAt < self.observedAt:
            raise ValueError("外部证据 availableAt 不能早于 observedAt")
        if self.expiresAt is not None and self.expiresAt < self.availableAt:
            raise ValueError("外部证据 expiresAt 不能早于 availableAt")
        return self


class FundamentalLiquidityCrowdingParameters(BaseStrategyParameters):
    """OHLCV proxies for the three-layer framework described in the source video.

    This model deliberately calls the first layer a proxy: daily bars cannot replace
    financial statements, order-book depth, financing terms, or short-interest data.
    """

    trendPeriod: Annotated[int, Field(ge=20, le=252)] = 120
    trendSlopeLookback: Annotated[int, Field(ge=1, le=60)] = 20
    liquidityPeriod: Annotated[int, Field(ge=5, le=120)] = 20
    minimumDollarVolumeRatio: Annotated[float, Field(gt=0, le=2)] = 0.5
    maximumIlliquidityMultiple: Annotated[float, Field(ge=1, le=20)] = 3
    crowdingPeriod: Annotated[int, Field(ge=5, le=120)] = 20
    maximumCrowdingZScore: Annotated[float, Field(gt=0, le=10)] = 2.5
    crowdingVolumeMultiple: Annotated[float, Field(ge=1, le=20)] = 1.5
    dataMode: Literal["ALLOW_PROXY_FALLBACK", "REQUIRE_VERIFIED_REAL"] = "ALLOW_PROXY_FALLBACK"
    minimumFundamentalGrowthScore: Annotated[float, Field(ge=-1, le=1)] = 0
    minimumOrderBookImbalance: Annotated[float, Field(ge=-1, le=1)] = -0.35
    maximumFinancialConditionsZ: Annotated[float, Field(ge=-10, le=10)] = 1
    maximumShortInterestPercent: Annotated[float, Field(ge=0, le=100)] = 30
    maximumDaysToCover: Annotated[float, Field(ge=0, le=100)] = 7
    fundamentalMaxAgeDays: Annotated[int, Field(ge=1, le=370)] = 140
    orderBookMaxAgeDays: Annotated[int, Field(ge=0, le=7)] = 1
    financingMaxAgeDays: Annotated[int, Field(ge=1, le=120)] = 30
    shortInterestMaxAgeDays: Annotated[int, Field(ge=1, le=60)] = 30

    @model_validator(mode="after")
    def validate_windows(self) -> FundamentalLiquidityCrowdingParameters:
        if self.trendSlopeLookback >= self.trendPeriod:
            raise ValueError("trendSlopeLookback 必须小于 trendPeriod")
        return self


def validate_strategy_parameters(
    strategy_type: StrategyType, parameters: dict[str, Any]
) -> BaseStrategyParameters:
    if strategy_type == "BuyAndHold":
        return BuyAndHoldParameters.model_validate(parameters)
    if strategy_type == "MovingAverageCross":
        return MovingAverageCrossParameters.model_validate(parameters)
    if strategy_type == "RsiMeanReversion":
        return RsiMeanReversionParameters.model_validate(parameters)
    if strategy_type == "TimeSeriesMomentum":
        return TimeSeriesMomentumParameters.model_validate(parameters)
    if strategy_type == "MultiHorizonTrend":
        return MultiHorizonTrendParameters.model_validate(parameters)
    if strategy_type == "DualMomentumRotation":
        return DualMomentumRotationParameters.model_validate(parameters)
    if strategy_type == "CoreSatelliteMomentum":
        return CoreSatelliteMomentumParameters.model_validate(parameters)
    return FundamentalLiquidityCrowdingParameters.model_validate(parameters)


class StrategyValidationRequest(StrictModel):
    strategyType: StrategyType
    parameters: dict[str, Any]


class IndicatorRequest(StrictModel):
    indicator: Literal["SMA", "RSI"]
    values: list[float] = Field(min_length=2)
    parameters: dict[str, Any]


class BacktestRequest(StrictModel):
    strategyType: StrategyType
    parameters: dict[str, Any]
    bars: list[MarketBar] = Field(min_length=2)
    evidence: list[StrategyEvidenceObservation] = Field(default_factory=list)
    initialCapital: Annotated[float, Field(gt=0)] = 100_000
    commissionModel: CommissionModel = "PERCENT_NOTIONAL"
    commissionRate: Annotated[float, Field(ge=0, le=0.1)] = 0.001
    commissionPerShare: Annotated[float, Field(ge=0, le=1)] = 0.0035
    minimumCommissionPerOrder: Annotated[float, Field(ge=0, le=100)] = 0.35
    maximumCommissionRate: Annotated[float, Field(gt=0, le=0.1)] = 0.01
    slippageRate: Annotated[float, Field(ge=0, le=0.1)] = 0.0005
    randomSeed: int = 42
    priceMode: Literal["ADJUSTED", "RAW_WITH_ACTIONS"] = "ADJUSTED"
    evaluationStartDate: date | None = None
    adverseOpenRate: Annotated[float, Field(ge=0, le=0.1)] = 0
    signalDelayDays: Annotated[int, Field(ge=0, le=20)] = 0
    skipTradePercent: Annotated[float, Field(ge=0, le=100)] = 0

    @model_validator(mode="after")
    def validate_bars(self) -> BacktestRequest:
        symbols = {bar.symbol for bar in self.bars}
        multi_asset = self.strategyType in {"DualMomentumRotation", "CoreSatelliteMomentum"}
        if not multi_asset and len(symbols) != 1:
            raise ValueError("V1.3 单次回测只允许一个标的")
        keys = [(bar.symbol, bar.tradeDate) for bar in self.bars]
        if len(keys) != len(set(keys)):
            raise ValueError("同一标的的行情日期不能重复")
        dates = [bar.tradeDate for bar in self.bars]
        if self.evaluationStartDate is not None and not (
            min(dates) <= self.evaluationStartDate <= max(dates)
        ):
            raise ValueError("evaluationStartDate 必须位于行情日期范围内")
        return self


class WalkForwardConfig(StrictModel):
    trainMonths: Annotated[int, Field(ge=3, le=120)] = 18
    testMonths: Annotated[int, Field(ge=1, le=36)] = 6
    anchored: bool = True
    maxWindows: Annotated[int, Field(ge=1, le=24)] = 6


class RobustnessValidationRequest(StrictModel):
    strategyType: StrategyType
    parameters: dict[str, Any]
    bars: list[MarketBar] = Field(min_length=120)
    crossSymbolBars: dict[str, list[MarketBar]] = Field(default_factory=dict)
    evidence: list[StrategyEvidenceObservation] = Field(default_factory=list)
    initialCapital: Annotated[float, Field(gt=0)] = 100_000
    commissionRate: Annotated[float, Field(ge=0, le=0.1)] = 0.001
    slippageRate: Annotated[float, Field(ge=0, le=0.1)] = 0.0005
    inSampleRatio: Annotated[float, Field(gt=0.5, lt=0.9)] = 0.7
    walkForward: WalkForwardConfig = Field(default_factory=WalkForwardConfig)
    parameterGrid: dict[str, list[int | float]] = Field(default_factory=dict)
    randomSeed: int = 42
    minimumOutOfSampleTrades: Annotated[int, Field(ge=0, le=500)] = 20


class SignalGenerationRequest(StrictModel):
    strategyType: StrategyType
    parameters: dict[str, Any]
    bars: list[MarketBar] = Field(min_length=2)
    evidence: list[StrategyEvidenceObservation] = Field(default_factory=list)
    currentQuantity: Annotated[float, Field(ge=0)] = 0
    targetAmount: Annotated[float, Field(gt=0)]


class PortfolioAnalysisRequest(StrictModel):
    strategyReturns: dict[str, list[float]]
    assetReturns: dict[str, list[float]] = Field(default_factory=dict)
    weights: dict[str, Annotated[float, Field(ge=0)]]
    strategyThemes: dict[str, str] = Field(default_factory=dict)
    rollingWindows: list[Annotated[int, Field(ge=2, le=252)]] = Field(
        default_factory=lambda: [20, 60]
    )

    @model_validator(mode="after")
    def validate_series(self) -> PortfolioAnalysisRequest:
        if len(self.strategyReturns) < 2:
            raise ValueError("组合分析至少需要两个策略收益序列")
        lengths = {len(values) for values in self.strategyReturns.values()}
        if len(lengths) != 1 or min(lengths, default=0) < 2:
            raise ValueError("策略收益序列必须等长且至少包含两个观测值")
        if set(self.weights) != set(self.strategyReturns):
            raise ValueError("策略权重必须与收益序列一一对应")
        if sum(self.weights.values()) <= 0:
            raise ValueError("策略权重合计必须大于 0")
        for values in self.assetReturns.values():
            if len(values) != next(iter(lengths)):
                raise ValueError("标的收益序列必须与策略收益序列等长")
        return self
