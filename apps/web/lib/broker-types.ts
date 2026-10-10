export type BrokerConnectionView = {
  autoReconciliation: boolean;
  capabilities: Record<string, boolean>;
  connectorUrl: string;
  displayName: string;
  enabled: boolean;
  environment: string;
  id: string;
  lastConnectedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  provider: string;
  runMode: string;
  safetyState: string;
  shadowTradingEnabled: boolean;
  staleAfterSeconds: number;
  status: string;
  updatedAt: string;
};

export type BrokerAccountView = {
  accountType: string;
  baseCurrency: string;
  cashBalances: Array<{
    availableCash: number;
    currency: string;
    id: string;
    settledCash: number;
    snapshotTime: string;
    totalCash: number;
  }>;
  id: string;
  lastSyncedAt: string | null;
  localAccountId: string | null;
  maskedAccountNumber: string;
  positionSnapshots: Array<{
    averageCost: number;
    currency: string;
    id: string;
    mappingStatus: string;
    marketPrice: number;
    marketValue: number;
    quantity: number;
    snapshotTime: string;
    symbol: string;
    unrealizedPnl: number;
  }>;
  snapshot: null | {
    availableFunds: number;
    buyingPower: number;
    currency: string;
    grossPositionValue: number;
    netLiquidation: number;
    realizedPnl: number;
    settledCash: number;
    snapshotTime: string;
    totalCash: number;
    unrealizedPnl: number;
  };
  stale: boolean;
  status: string;
};

export type BrokerSyncJobView = {
  accountCount: number;
  completedAt: string | null;
  corporateActionCount: number;
  createdAt: string;
  errorMessage: string | null;
  executionCount: number;
  id: string;
  idempotencyKey: string;
  orderCount: number;
  positionCount: number;
  requestedFrom: string | null;
  requestedTo: string | null;
  retryCount: number;
  snapshotCount: number;
  status: string;
};

export type ReconciliationDifferenceView = {
  absoluteDifference: number | null;
  brokerValue: string | null;
  createdAt: string;
  differenceType: string;
  fieldName: string;
  id: string;
  localValue: string | null;
  percentageDifference: number | null;
  resolvedAt: string | null;
  severity: string;
  status: string;
  suggestedAction: string;
  symbol: string | null;
};

export type ReconciliationRunView = {
  brokerAccountId: string;
  brokerSnapshotTime: string;
  completedAt: string | null;
  createdAt: string;
  criticalDifferenceCount: number;
  decisions: Array<{
    acceptedValue: string | null;
    createdAt: string;
    decision: string;
    id: string;
    operatorId: string;
    reason: string;
  }>;
  differenceCount: number;
  differences: ReconciliationDifferenceView[];
  id: string;
  localAccountId: string;
  status: string;
};

export type ShadowSessionView = {
  brokerAccountId: string;
  brokerSnapshotTime: string;
  createdAt: string;
  currentCash: number;
  currentEquity: number;
  fills: Array<{
    commission: number;
    fillPrice: number;
    fillTime: string;
    id: string;
    quantity: number;
    side: string;
    slippage: number;
    symbol: string;
  }>;
  id: string;
  initialCash: number;
  initialEquity: number;
  orderIntents: Array<{
    createdAt: string;
    id: string;
    quantity: number;
    rejectionReason: string | null;
    side: string;
    status: string;
    symbol: string;
    theoreticalOrderAt: string;
    theoreticalPrice: number;
  }>;
  performance: Array<{
    cashBalance: number;
    id: string;
    maxDrawdown: number;
    opportunityPnl: number | null;
    snapshotTime: string;
    totalEquity: number;
    totalReturn: number;
  }>;
  signals: Array<{
    id: string;
    quantity: number;
    referencePrice: number;
    side: string;
    signalDate: string;
    status: string;
    symbol: string;
  }>;
  startedAt: string;
  status: string;
};

export type ReadinessView = {
  dimensions: Record<string, number | string | boolean>;
  infrastructure: { score: number; status: string };
  portfolio: { score: number; status: string };
  statement: string;
  strategy: { score: number; status: string };
};

export type BrokerDashboard = {
  accounts: BrokerAccountView[];
  auditLogs: Array<{
    actorId: string | null;
    createdAt: string;
    eventType: string;
    id: string;
    message: string;
    severity: string;
  }>;
  connection: BrokerConnectionView;
  control: { killSwitchEnabled: boolean; reason: string | null };
  disclaimers: {
    brokerWrites: string;
    opportunityPnl: string;
    readiness: string;
  };
  readiness: ReadinessView;
  reconciliationRuns: ReconciliationRunView[];
  safeguards: Record<string, unknown>;
  shadowSessions: ShadowSessionView[];
  syncJobs: BrokerSyncJobView[];
};

export type ServiceStatusView = {
  connection: BrokerConnectionView;
  latestReconciliation: { completedAt: string | null; status: string } | null;
  latestShadow: { startedAt: string; status: string } | null;
  latestSync: { completedAt: string | null; status: string } | null;
  services: Array<{
    dataUpdatedAt: string | null;
    lastError: string | null;
    latencyMs: number;
    name: string;
    status: string;
    version: string;
  }>;
};
