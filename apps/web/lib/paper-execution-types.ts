export type BrokerPaperApproval = {
  actorId: string;
  approvedAt: string | null;
  createdAt: string;
  decision: string;
  expiresAt: string;
  id: string;
  reason: string;
};

export type ExecutionGuardView = {
  accountSnapshotTime: string | null;
  checksJson: string;
  createdAt: string;
  decision: string;
  id: string;
  marketDataTime: string | null;
  reason: string | null;
};

export type BrokerOrderProposalView = {
  approvals: BrokerPaperApproval[];
  brokerAccountId: string;
  correlationId: string;
  createdAt: string;
  estimatedCommission: number;
  estimatedValue: number;
  entryPrice: number | null;
  exitCondition: string | null;
  plannedLoss: number | null;
  plannedLossPct: number | null;
  plannedStopPrice: number | null;
  allowOvernight: boolean | null;
  gapStressJson: string | null;
  predefinedScalePlanId: string | null;
  predefinedScaleVersion: number | null;
  expirationTime: string;
  guardDecisions: ExecutionGuardView[];
  id: string;
  allowPartialFill: boolean;
  limitPrice: number | null;
  orderType: string;
  outsideRth: boolean;
  paperOrder: BrokerPaperOrderView | null;
  quantity: number;
  maxSlippage: number;
  portfolioId: string | null;
  portfolioRiskDecisionId: string | null;
  proposalSnapshotJson: string;
  riskDecisionId: string;
  side: string;
  status: string;
  strategyDeploymentId: string | null;
  strategyId: string | null;
  strategyVersion: string;
  stopPrice: number | null;
  symbol: string;
  timeInForce: string;
};

export type BrokerPaperCommissionView = {
  amount: number;
  currency: string;
  id: string;
  realizedPnl: number | null;
  reportTime: string;
};

export type BrokerPaperExecutionView = {
  commissions: BrokerPaperCommissionView[];
  currency: string;
  exchange: string;
  executionTime: string;
  externalExecutionId: string | null;
  id: string;
  price: number;
  quantity: number;
  side: string;
  symbol: string;
};

export type BrokerPaperOrderView = {
  averageFillPrice: number | null;
  brokerReplyId: string | null;
  brokerReplyMessage: string | null;
  brokerReplyReceivedAt: string | null;
  correlationId: string;
  createdAt: string;
  errorMessage: string | null;
  events: Array<{
    eventTime: string;
    id: string;
    reason: string | null;
    status: string;
  }>;
  executions: BrokerPaperExecutionView[];
  externalOrderId: string | null;
  filledQuantity: number;
  id: string;
  limitPrice: number | null;
  orderType: string;
  quantity: number;
  remainingQuantity: number;
  side: string;
  status: string;
  symbol: string;
  updatedAt: string;
};

export type BrokerPaperDashboard = {
  accounts: Array<{
    accountType: string;
    baseCurrency: string;
    id: string;
    lastSyncedAt: string | null;
    maskedAccountNumber: string;
    snapshot: Record<string, unknown> | null;
    status: string;
  }>;
  backups: Array<{
    actorId: string;
    completedAt: string | null;
    createdAt: string;
    errorMessage: string | null;
    id: string;
    operation: string;
    startedAt: string;
    status: string;
    targetDatabase: string;
    verificationJson: string | null;
  }>;
  connector: {
    capabilities: Record<string, boolean>;
    health: { checkedAt?: string; latencyMs?: number; message?: string; status: string };
  };
  configuration: {
    enabled: boolean;
    environment: string;
    runMode: string;
    status: string;
  } | null;
  control: {
    killSwitchLevel: string;
    reason: string | null;
    safetyState: string;
    updatedAt: string;
  };
  incidents: Array<{
    actionTaken: string | null;
    correlationId: string;
    impact: string;
    incidentType: string;
    occurredAt: string;
    severity: string;
    status: string;
  }>;
  isolation: {
    brokerPaperTablesOnly: boolean;
    internalPaperUnchanged: boolean;
    liveAccountWrites: boolean;
    shadowUnchanged: boolean;
  };
  orders: BrokerPaperOrderView[];
  proposals: BrokerOrderProposalView[];
  reconciliations: Array<{
    completedAt: string | null;
    criticalDifferenceCount: number;
    differenceCount: number;
    differences: Array<{
      brokerValue: string | null;
      differenceType: string;
      fieldName: string;
      id: string;
      localValue: string | null;
      reason: string;
      severity: string;
      status: string;
      suggestedAction: string;
    }>;
    id: string;
    startedAt: string;
    status: string;
  }>;
  safetyStatement: string;
  supportedOrderTypes: string[];
};

export type BrokerExecutionMonitor = {
  apiLatencyMs: number;
  averageSubmissionLatencyMs: number | null;
  brokerConnector: BrokerPaperDashboard["connector"];
  correlationTracking: boolean;
  database: { latencyMs: number; status: string };
  executionIncidents: number;
  ibkrHeartbeatAt: string | null;
  killSwitchLevel: string;
  latestOrderStatusAt: string | null;
  marketDataLatencyHours: number | null;
  openReconciliationDifferences: number;
  quantEngine: { status: string };
  recentIncidents: BrokerPaperDashboard["incidents"];
  requestErrorRate: number;
  safetyState: string;
  submissionUnknown: number;
  taskFailureRate: number;
};
