export * from "./data-origin";
export const APP_NAME = "XichuQuant / 西楚量化交易系统";
export const APP_NAME_EN = "XichuQuant — Quantitative Trading & Risk Management";
export const WEB_PORT = 5088;
export const API_PORT = 5089;

export const RISK_LEVELS = ["LOW", "MEDIUM", "WARNING", "DANGER", "VIOLATION"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export type AccountView = {
  dataOrigin?: import("./data-origin").DataOrigin | "UNKNOWN";
  id: string;
  name: string;
  broker: string | null;
  brokerAccountId: string | null;
  baseCurrency: string;
  initialCapital: number;
  totalEquity: number;
  cashBalance: number;
  realizedPnlYtd: number;
  note?: string | null;
};

export type AccountPerformancePoint = {
  date: string;
  equity: number;
  cashBalance: number;
  realizedPnlYtd: number | null;
  periodPnl: number | null;
  periodReturnPercent: number | null;
  drawdownPercent: number | null;
  note: string | null;
};

export type AccountPerformance = {
  returnsVerified?: boolean;
  returnsStatus?: string;
  dataOrigin?: string;
  accountId: string;
  accountName: string;
  accountType?: string;
  dataSource?: "BROKER_SYNC" | "LOCAL_ACCOUNT";
  snapshotTime?: string;
  period: "1M" | "3M" | "YTD" | "1Y" | "ALL";
  periodLabel: string;
  initialCapital: number;
  periodStartEquity: number;
  currentEquity: number;
  totalNetPnl: number | null;
  totalReturnPercent: number | null;
  periodPnl: number | null;
  periodReturnPercent: number | null;
  realizedPnlYtd: number | null;
  unrealizedPnl: number;
  cashBalance: number;
  cashPercent: number;
  peakEquity: number;
  maxDrawdownPercent: number | null;
  profitPeriods: number;
  lossPeriods: number;
  winRatePercent: number;
  profitFactor: number | null;
  series: AccountPerformancePoint[];
};

export type PositionRiskView = {
  id: string;
  symbol: string;
  name: string;
  assetType: string;
  category: string | null;
  theme: string | null;
  underlyingSymbol?: string | null;
  riskTheme?: string | null;
  sector?: string | null;
  industry?: string | null;
  leverageMultiplier?: number;
  direction?: string;
  leveragedETF?: boolean;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  costAmount: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  positionPercent: number;
  effectiveExposure: number;
  effectiveExposurePercent: number;
  riskLevel: RiskLevel;
  suggestedAction: string;
};

export type RiskAlertView = {
  code: string;
  level: RiskLevel;
  title: string;
  message: string;
  symbol?: string;
  currentValue: number;
  limitValue: number;
  unit: "PERCENT";
  suggestedAction: string;
};

export type RiskSummary = {
  dataOrigin?: string;
  annualPnlKnown?: boolean;
  realizedPnlPeriod?: string;
  brokerSessionRealizedPnl?: number;
  accountId: string;
  accountName: string;
  brokerAccountId?: string;
  accountType?: string;
  dataSource?: "BROKER_SYNC" | "LOCAL_ACCOUNT";
  snapshotTime?: string;
  totalEquity: number;
  cashBalance: number;
  cashPercent: number;
  positionValue: number;
  positionPercent: number;
  leveragedEtfValue: number;
  leveragedEtfPercent: number;
  grossEffectiveExposure: number;
  grossEffectiveExposurePercent: number;
  netDirectionalExposure: number;
  netDirectionalExposurePercent: number;
  exposureBySymbol: ExposureBucketView[];
  exposureByUnderlying: ExposureBucketView[];
  exposureByIndustry: ExposureBucketView[];
  exposureBySector: ExposureBucketView[];
  exposureByRiskTheme: ExposureBucketView[];
  maxRiskThemeEffectiveExposurePercent: number;
  maxSinglePositionPercent: number;
  storageThemeValue: number;
  storageThemePercent: number;
  unrealizedPnlTotal: number;
  unrealizedLossTotal: number;
  realizedPnlYtd: number | null;
  annualNetPnl: number;
  floatingLossToRealizedProfitPercent: number;
  overallRiskLevel: RiskLevel;
  messages: string[];
  alerts: RiskAlertView[];
  positions: PositionRiskView[];
};

export type ExposureBucketView = {
  grossEffectiveExposure: number;
  grossEffectiveExposurePct: number;
  key: string;
  netDirectionalExposure: number;
  netDirectionalExposurePct: number;
  principal: number;
  principalPct: number;
  symbols: string[];
};

export type InstrumentView = {
  id: string;
  symbol: string;
  name: string | null;
  market: string | null;
  assetType: string;
  category: string | null;
  theme: string | null;
  underlyingSymbol: string | null;
  riskTheme: string | null;
  sector: string | null;
  industry: string | null;
  leverageRatio: number | null;
  leverageMultiplier: number;
  direction: string;
  leveragedETF: boolean;
  isActive: boolean;
};

export type RiskRuleView = {
  id: string;
  code: string;
  name: string;
  ruleType: string;
  limitValue: number;
  level: RiskLevel;
  enabled: boolean;
};

export type TradeView = {
  id: string;
  date: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  amount: number;
  emotion: string | null;
  followedRule: boolean | null;
};

export type ReviewRecord = {
  id: string;
  title: string;
  symbol: string | null;
  mistakeType: string | null;
  summary: string;
  lesson: string;
  actionRule: string | null;
  createdAt?: string;
};

export type TradePlanReviewResult = {
  planId?: string;
  passed: boolean;
  level: RiskLevel;
  messages: string[];
  suggestedAction: string;
};

export type ImportRecordStatus =
  "VALID" | "PENDING" | "DUPLICATE" | "IMPORTED" | "FAILED" | "ROLLED_BACK";

export type ImportRecordView = {
  id: string;
  batchId: string;
  sourceSection: string;
  sourceRow: number;
  recordType: string;
  status: ImportRecordStatus;
  externalId: string;
  externalAccountId: string | null;
  transactionDate: string | null;
  symbol: string | null;
  currency: string | null;
  action: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  commission: number | null;
  realizedPnl: number | null;
  validationErrors: string[];
  resolutionNote: string | null;
  normalized: {
    description: string | null;
    assetClass: string | null;
    currentPrice: number | null;
    costBasis: number | null;
    marketValue: number | null;
    netCash: number | null;
    fxRateToBase: number | null;
    corporateActionType: string | null;
    splitRatio: number | null;
  };
};

export type ImportBatchResult = {
  adapter?: "ACTIVITY_STATEMENT" | "FLEX_QUERY";
  matchStatus?: "EXACT" | "UNBOUND" | "MISSING" | "MISMATCH" | "MULTIPLE";
  externalAccountIds?: string[];
  message?: string;
  importedRecords?: number;
  duplicateRecords?: number;
  totalEquity?: number;
  cashBalance?: number;
  realizedPnlYtd?: number;
  positionCount?: number;
  riskLevel?: RiskLevel;
  riskAlertCount?: number;
};

export type ImportBatchSummary = {
  id: string;
  accountId: string;
  accountName: string;
  source: string;
  fileName: string;
  fileHash: string;
  status: string;
  statementAccountId: string | null;
  statementStart: string | null;
  statementEnd: string | null;
  totalRecords: number;
  validRecords: number;
  pendingRecords: number;
  duplicateRecords: number;
  importedRecords: number;
  failedRecords: number;
  result: ImportBatchResult;
  errorMessage: string | null;
  confirmedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportBatchDetail = ImportBatchSummary & {
  baseCurrency: string;
  brokerAccountId: string | null;
  records: ImportRecordView[];
};
