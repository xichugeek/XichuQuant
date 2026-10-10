export type PortfolioMember = {
  id: string;
  priority: number;
  status: string;
  targetAllocationPercent: number;
  manualAmount: number;
  maxCapitalPercent: number;
  virtualCapital: number;
  virtualCash: number;
  realizedPnl: number;
  strategy: {
    id: string;
    name: string;
    code: string;
    approvalStatus: string;
    symbolUniverse: string[];
  };
  deployment: { id: string; name: string; status: string } | null;
};

export type PortfolioRiskRule = {
  version: number;
  singleStrategyMaxPercent: number;
  singleSymbolMaxPercent: number;
  singleThemeMaxPercent: number;
  leveragedEtfMaxPercent: number;
  leveragedStrategyMaxPercent: number;
  correlatedStrategiesMaxPercent: number;
  correlationThreshold: number;
  maxConcurrentPositions: number;
  minCashPercent: number;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxLosingStrategies: number;
  maxStrategyDrawdownContributionPercent: number;
};

export type PortfolioRun = {
  id: string;
  tradeDate: string;
  runType: string;
  status: string;
  conflictPolicy: string;
  allocationVersion: number;
  riskVersion: number;
  estimatedCommission: number;
  estimatedCash: number;
  previewOnly: boolean;
  beforeAllocation: unknown;
  afterAllocation: unknown;
  rawSignals: Array<{ id: string; symbol: string; side: string; portfolioStrategyId: string }>;
  estimatedOrders: Array<{
    symbol: string;
    side: string;
    quantity: number;
    referencePrice: number;
  }>;
  riskResult: {
    allowed: boolean;
    projected?: {
      leveragedExposure: number;
      symbolExposure: Record<string, number>;
      themeExposure: Record<string, number>;
    };
    violations: Array<{ code: string; level: string; message: string }>;
  };
  createdAt: string;
};

export type StrategyPortfolio = {
  id: string;
  name: string;
  description: string | null;
  baseCurrency: string;
  initialCapital: number;
  cashBalance: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  peakEquity: number;
  maxDrawdown: number;
  cashReservePercent: number;
  allocationMode: string;
  rebalanceMode: string;
  conflictPolicy: string;
  status: string;
  noNewPositions: boolean;
  readOnlyMode: boolean;
  strategies: PortfolioMember[];
  allocationRules: Array<{
    id: string;
    version: number;
    allocationMode: string;
    effectiveFrom: string;
    configuration: unknown;
  }>;
  riskRules: PortfolioRiskRule[];
  snapshots: Array<{
    id: string;
    snapshotDate: string;
    totalEquity: number;
    cashBalance: number;
    positionValue: number;
    totalReturn: number;
    dailyReturn: number;
    drawdown: number;
    benchmarkEquity: number;
  }>;
  positions: Array<{
    id: string;
    symbol: string;
    assetType: string;
    theme: string | null;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
  }>;
  rebalanceRuns: PortfolioRun[];
  orders: Array<{
    id: string;
    symbol: string;
    side: string;
    signalTradeDate: string;
    earliestFillDate: string | null;
    approvedQuantity: number;
    status: string;
    rejectionReason: string | null;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    severity: string;
    createdAt: string;
    payload: unknown;
  }>;
};

export type PortfolioDashboard = {
  portfolio: StrategyPortfolio | null;
  control: { killSwitchEnabled: boolean; reason: string | null };
  availableStrategies: Array<{
    id: string;
    name: string;
    code: string;
    approvalStatus: string;
    symbolUniverse: string[];
    deployments: Array<{ id: string; name: string; status: string }>;
  }>;
  safeguards: Record<string, boolean>;
};
