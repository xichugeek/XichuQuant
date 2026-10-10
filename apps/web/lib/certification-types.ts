export type CertificationRunView = {
  blockedReason: string | null;
  certificationType: string;
  completedAt: string | null;
  environment: string;
  id?: string;
  maskedAccount?: string | null;
  prerequisites: unknown;
  result: unknown;
  startedAt: string | null;
  status: string;
};

export type SoakSampleView = {
  apiAvailable: boolean;
  apiLatencyMs: number;
  brokerAvailable: boolean;
  brokerReconnectCount: number;
  databaseAvailable: boolean;
  duplicateOrderCount: number;
  memoryMb: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  quantAvailable: boolean;
  reconciliationDifference: number;
  sampledAt: string;
  taskSuccessRate: number;
  unrecoveredTaskCount: number;
};

export type CertificationDashboard = {
  backup: null | { status: string; targetDatabase: string; verification: unknown };
  blockingMessages: string[];
  bundles: Array<{
    checksum: string;
    createdAt: string;
    evidence: unknown;
    externalStatus: string;
    faultStatus: string;
    id: string;
    ledgerStatus: string;
    linuxStatus: string;
    readinessStatus: string;
    soakStatus: string;
    status: string;
    version: string;
  }>;
  evidences: Array<{
    category: string;
    checksum: string;
    evidenceType: string;
    id: string;
    isExternal: boolean;
    occurredAt: string;
    sensitiveDataRedacted: boolean;
    source: string;
    status: string;
    summary: string;
  }>;
  external: CertificationRunView;
  externalOrderEvidence: {
    executionCount: number;
    orderId: string | null;
    reason: string;
    status: string;
  };
  faults: Array<{
    actualBehavior: string | null;
    blockedReason: string | null;
    completedAt: string | null;
    duplicateOrders: number;
    expectedBehavior: string;
    ledgerPolluted: boolean;
    notificationTriggered: boolean;
    recovered: boolean;
    scenario: string;
    startedAt: string | null;
    status: string;
  }>;
  integrity: null | {
    checkCount: number;
    checks: Array<{
      code: string;
      expected: string | null;
      message: string;
      observed: string | null;
      severity: string;
      status: string;
    }>;
    completedAt: string | null;
    criticalCount: number;
    passedCount: number;
    source: string;
    status: string;
    warningCount: number;
  };
  linux: CertificationRunView;
  readinessStatus: string;
  releaseStatus: string;
  securityChecklist: Array<{ code: string; description: string; status: string }>;
  soak: null | {
    actualDurationMinutes: number;
    continuous: boolean;
    effectiveStatus: string;
    environment: string;
    expectedEndAt: string;
    id: string;
    progressPercent: number;
    maximumObservedGapMinutes: number;
    readinessStatus: string;
    sampleCount: number;
    samples: SoakSampleView[];
    startedAt: string;
    status: string;
    targetHours: number;
  };
  version: string;
};
