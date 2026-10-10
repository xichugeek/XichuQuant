export type MarketDataSummary = {
  providers: Array<{
    id: string;
    code: string;
    name: string;
    providerType: string;
    enabled: boolean;
    lastSyncAt: string | null;
  }>;
  series: Array<{
    count: number;
    endDate: string;
    source: string;
    startDate: string;
    symbol: string;
  }>;
  importBatches: Array<{
    id: string;
    fileName: string;
    status: string;
    importedRecords: number;
    createdAt: string;
  }>;
  syncJobs: Array<{ id: string; status: string }>;
};

export type MarketImportPreview = {
  id: string;
  fileName: string;
  status: string;
  totalRecords: number;
  validRecords: number;
  pendingRecords: number;
  duplicateRecords: number;
  importedRecords: number;
  startDate: string | null;
  endDate: string | null;
  mapping: Record<string, string>;
  missingDays: Array<{ date: string; symbol: string }>;
  records: Array<{
    id: string;
    sourceRow: number;
    status: string;
    symbol: string | null;
    tradeDate: string | null;
    errors: string[];
    normalized: Record<string, unknown> | null;
  }>;
};

export type StrategyView = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  strategyType:
    | "BuyAndHold"
    | "MovingAverageCross"
    | "RsiMeanReversion"
    | "TimeSeriesMomentum"
    | "FundamentalLiquidityCrowding";
  version: number;
  symbolUniverse: string[];
  timeframe: string;
  parameters: Record<string, unknown>;
  initialCapital: number;
  commissionRate: number;
  slippageRate: number;
  maxPositionPercent: number;
  enabled: boolean;
  _count?: { backtestRuns: number; signals: number };
};

export type StrategyEvidenceDashboard = {
  symbol: string;
  mode: "REQUIRE_VERIFIED_REAL";
  ready: boolean;
  missingMetrics: string[];
  requiredMetrics: string[];
  researchOnlyMetrics: string[];
  providers: Array<{
    id: string;
    code: string;
    name: string;
    evidenceType: string;
    configured: boolean;
    lastHealthStatus: string | null;
    lastHealthMessage: string | null;
  }>;
  latest: Array<{
    id: string;
    metricCode: string;
    value: number;
    unit: string | null;
    observedAt: string;
    availableAt: string;
    sourceUrl: string;
    provider: { code: string; name: string };
  }>;
  safeguards: {
    acceptsFutureKnowledge: boolean;
    usesOnlyVerifiedEvidence: boolean;
    missingEvidenceAction: string;
    note: string;
  };
};

export type BacktestRunView = {
  id: string;
  strategyId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  symbol: string;
  strategyVersion: number;
  marketDataSource: string;
  marketDataStart: string;
  marketDataEnd: string;
  initialCapital: number;
  commissionRate: number;
  slippageRate: number;
  finalEquity: number | null;
  totalReturn: number | null;
  maxDrawdown: number | null;
  sharpeRatio: number | null;
  benchmarkReturn: number | null;
  totalCommission: number | null;
  tradeCount: number | null;
  runDurationMs: number | null;
  riskNotice: string | null;
  errorMessage: string | null;
  createdAt: string;
  metrics: Record<string, number | null> | null;
  monthlyReturns: Array<{ month: string; return: number }>;
  parameters: Record<string, unknown>;
  strategy?: StrategyView;
  equityPoints?: Array<{
    tradeDate: string;
    equity: number;
    cash: number;
    positionValue: number;
    drawdown: number;
    benchmarkEquity: number;
  }>;
  trades?: Array<{
    id: string;
    symbol: string;
    side: string;
    signalTime: string;
    orderTime: string;
    executionTime: string;
    executionPrice: number;
    quantity: number;
    notional: number;
    commission: number;
    slippage: number;
    realizedPnl: number | null;
    holdingDays: number | null;
    triggerReason: string;
  }>;
  signals?: StrategySignalView[];
  marketData?: Array<{
    tradeDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

export type StrategySignalView = {
  id: string;
  strategyId: string;
  symbol: string;
  signalType: string;
  signalTime: string;
  requestedAmount: number | null;
  referencePrice: number | null;
  stopLossCondition: string | null;
  exitCondition: string | null;
  status: string;
  triggerReason: string;
  rejectionReason: string | null;
  riskResult: {
    approved: boolean;
    message: string;
    violations: Array<{
      code: string;
      currentValue: number | null;
      expectedValue: number | null;
      limitValue: number | null;
      reason: string;
    }>;
  } | null;
  strategy?: StrategyView;
  account?: { id: string; name: string } | null;
};
