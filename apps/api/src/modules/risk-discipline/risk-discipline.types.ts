export type ExposureDirection = "LONG" | "SHORT";

export type InstrumentRiskMetadata = {
  direction: string;
  industry: string | null;
  leveragedETF: boolean;
  leverageMultiplier: number;
  riskTheme: string | null;
  sector: string | null;
  symbol: string;
  underlyingSymbol: string | null;
};

export type ExposurePositionInput = InstrumentRiskMetadata & {
  marketValue: number;
};

export type ExposureBucket = {
  grossEffectiveExposure: number;
  grossEffectiveExposurePct: number;
  key: string;
  netDirectionalExposure: number;
  netDirectionalExposurePct: number;
  principal: number;
  principalPct: number;
  symbols: string[];
};

export type ExposureSummary = {
  accountEquity: number;
  grossEffectiveExposure: number;
  grossEffectiveExposurePct: number;
  leveragedEtfPrincipal: number;
  leveragedEtfPrincipalPct: number;
  netDirectionalExposure: number;
  netDirectionalExposurePct: number;
  byIndustry: ExposureBucket[];
  byRiskTheme: ExposureBucket[];
  bySector: ExposureBucket[];
  bySymbol: ExposureBucket[];
  byUnderlying: ExposureBucket[];
};

export type TradeRiskBudget = {
  allowed: boolean;
  limitPct: number;
  plannedLoss: number;
  plannedLossPct: number;
  reasons: string[];
};

export type GapStressScenario = {
  accountLossPct: number;
  gapPct: number;
  projectedLoss: number;
};

export type GapStressResult = {
  allowed: boolean;
  maxAccountLossPct: number;
  scenarios: GapStressScenario[];
  warning: string;
};

export type ScalePlanSnapshot = {
  allowOvernight: boolean;
  approvedAt: Date;
  createdAt: Date;
  expiresAt: Date | null;
  finalStopPrice: number;
  firstFilledAt: Date | null;
  id: string;
  maxAccountRiskPct: number;
  maxPrincipalPercent: number;
  maxTotalQuantity: number;
  status: string;
  tranches: Array<{ price: number; quantity: number }>;
  version: number;
};

export type RiskDisciplineLimits = {
  leveragedEtfMaxRiskPerTradePct: number;
  leveragedEtfSingleMaxPct: number;
  leveragedEtfTotalMaxPct: number;
  maxRiskPerTradePct: number;
  overnightGapStressMaxLossPct: number;
  riskThemeEffectiveGrossMaxPct: number;
  singleStockMaxPct: number;
};

export type OrderDisciplineInput = {
  accountEquity: number;
  allowOvernight: boolean | undefined;
  currentPositionQuantity: number;
  entryPrice: number;
  estimatedFees: number;
  estimatedSlippage: number;
  exitCondition: string | null | undefined;
  exposureAfter: ExposureSummary;
  firstFillAt: Date | null;
  increasesExposure: boolean;
  instrument: InstrumentRiskMetadata;
  killSwitchLevel: string;
  limits: RiskDisciplineLimits;
  positionUnrealizedPnl: number;
  profitGivebackState: ProfitGivebackState;
  projectedPositionQuantity: number;
  quantity: number;
  scalePlan: ScalePlanSnapshot | null;
  stopPrice: number | null | undefined;
};

export type OrderDisciplineDecision = {
  allowed: boolean;
  budget: TradeRiskBudget;
  gapStress: GapStressResult | null;
  hardBlockReasons: Array<{ code: string; message: string }>;
};

export type AmendmentDecision = {
  allowed: boolean;
  code: "ALLOWED" | "RISK_INCREASING_AMENDMENT";
  reasons: string[];
};

export type ProfitGivebackState = "NORMAL" | "REDUCED_RISK" | "DEFENSIVE" | "KILL_SWITCH";

export type ProfitGivebackResult = {
  currentYtdPnl: number;
  peakYtdPnl: number;
  profitGivebackAmount: number;
  profitGivebackPct: number;
  state: ProfitGivebackState;
};
