export type RiskLevel = "LOW" | "MEDIUM" | "WARNING" | "DANGER" | "VIOLATION";

export type RiskRuleInput = {
  code: string;
  enabled: boolean;
  level: string;
  limitValue: number;
};

export type RiskAccountInput = {
  id: string;
  name: string;
  totalEquity: number;
  cashBalance: number;
  realizedPnlYtd: number;
};

export type RiskPositionInput = {
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
};

export type PositionRiskView = RiskPositionInput & {
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
  exposureBySymbol: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
  exposureByUnderlying: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
  exposureByIndustry: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
  exposureBySector: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
  exposureByRiskTheme: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
  maxRiskThemeEffectiveExposurePercent: number;
  maxSinglePositionPercent: number;
  storageThemeValue: number;
  storageThemePercent: number;
  unrealizedPnlTotal: number;
  unrealizedLossTotal: number;
  realizedPnlYtd: number;
  annualNetPnl: number;
  floatingLossToRealizedProfitPercent: number;
  overallRiskLevel: RiskLevel;
  messages: string[];
  alerts: RiskAlertView[];
  positions: PositionRiskView[];
};
