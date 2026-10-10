CREATE TABLE [ExternalCertificationRun] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [ExternalCertificationRun_id_df] DEFAULT NEWID(),
    [certificationType] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ExternalCertificationRun_status_df] DEFAULT 'BLOCKED',
    [blockedReason] NVARCHAR(MAX),
    [operatorId] NVARCHAR(1000) NOT NULL,
    [systemVersion] NVARCHAR(1000) NOT NULL,
    [connectorVersion] NVARCHAR(1000),
    [environment] NVARCHAR(1000) NOT NULL,
    [maskedAccount] NVARCHAR(1000),
    [prerequisitesJson] NVARCHAR(MAX) NOT NULL,
    [resultJson] NVARCHAR(MAX) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ExternalCertificationRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ExternalCertificationRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [CertificationEvidence] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [CertificationEvidence_id_df] DEFAULT NEWID(),
    [certificationRunId] NVARCHAR(1000),
    [category] NVARCHAR(1000) NOT NULL,
    [evidenceType] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    [isExternal] BIT NOT NULL CONSTRAINT [CertificationEvidence_isExternal_df] DEFAULT 0,
    [sensitiveDataRedacted] BIT NOT NULL CONSTRAINT [CertificationEvidence_sensitiveDataRedacted_df] DEFAULT 1,
    [summary] NVARCHAR(MAX) NOT NULL,
    [payloadJson] NVARCHAR(MAX) NOT NULL,
    [checksum] VARCHAR(64) NOT NULL,
    [correlationId] VARCHAR(64),
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CertificationEvidence_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CertificationEvidence_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CertificationEvidence_certificationRunId_fkey] FOREIGN KEY ([certificationRunId]) REFERENCES [ExternalCertificationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [SoakTestRun] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [SoakTestRun_id_df] DEFAULT NEWID(),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [SoakTestRun_status_df] DEFAULT 'RUNNING',
    [readinessStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [SoakTestRun_readinessStatus_df] DEFAULT 'OBSERVING',
    [targetHours] INT NOT NULL CONSTRAINT [SoakTestRun_targetHours_df] DEFAULT 72,
    [environment] NVARCHAR(1000) NOT NULL,
    [operatorId] NVARCHAR(1000) NOT NULL,
    [baselineJson] NVARCHAR(MAX) NOT NULL,
    [resultJson] NVARCHAR(MAX),
    [startedAt] DATETIME2 NOT NULL,
    [expectedEndAt] DATETIME2 NOT NULL,
    [stoppedAt] DATETIME2,
    [actualDurationMinutes] INT NOT NULL CONSTRAINT [SoakTestRun_actualDurationMinutes_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SoakTestRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SoakTestRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [SoakMetricSample] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [SoakMetricSample_id_df] DEFAULT NEWID(),
    [soakTestRunId] NVARCHAR(1000) NOT NULL,
    [sampledAt] DATETIME2 NOT NULL,
    [apiAvailable] BIT NOT NULL,
    [brokerAvailable] BIT NOT NULL,
    [quantAvailable] BIT NOT NULL,
    [databaseAvailable] BIT NOT NULL,
    [apiLatencyMs] FLOAT(53) NOT NULL,
    [p95LatencyMs] FLOAT(53) NOT NULL,
    [p99LatencyMs] FLOAT(53) NOT NULL,
    [apiErrorRate] FLOAT(53) NOT NULL,
    [memoryMb] FLOAT(53) NOT NULL,
    [cpuLoad] FLOAT(53) NOT NULL,
    [databaseConnections] INT,
    [taskSuccessRate] FLOAT(53) NOT NULL,
    [taskDuplicateCount] INT NOT NULL,
    [reconciliationDifference] INT NOT NULL,
    [duplicateOrderCount] INT NOT NULL,
    [unrecoveredTaskCount] INT NOT NULL,
    [diskFreeGb] FLOAT(53),
    [logSizeMb] FLOAT(53),
    [brokerReconnectCount] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SoakMetricSample_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SoakMetricSample_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SoakMetricSample_soakTestRunId_fkey] FOREIGN KEY ([soakTestRunId]) REFERENCES [SoakTestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [FaultInjectionRun] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [FaultInjectionRun_id_df] DEFAULT NEWID(),
    [scenario] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [FaultInjectionRun_status_df] DEFAULT 'BLOCKED',
    [expectedBehavior] NVARCHAR(MAX) NOT NULL,
    [actualBehavior] NVARCHAR(MAX),
    [duplicateOrders] INT NOT NULL CONSTRAINT [FaultInjectionRun_duplicateOrders_df] DEFAULT 0,
    [ledgerPolluted] BIT NOT NULL CONSTRAINT [FaultInjectionRun_ledgerPolluted_df] DEFAULT 0,
    [notificationTriggered] BIT NOT NULL CONSTRAINT [FaultInjectionRun_notificationTriggered_df] DEFAULT 0,
    [recovered] BIT NOT NULL CONSTRAINT [FaultInjectionRun_recovered_df] DEFAULT 0,
    [manualActionRequired] BIT NOT NULL CONSTRAINT [FaultInjectionRun_manualActionRequired_df] DEFAULT 0,
    [blockedReason] NVARCHAR(MAX),
    [operatorId] NVARCHAR(1000) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [evidenceJson] NVARCHAR(MAX) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FaultInjectionRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [FaultInjectionRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [LedgerIntegrityRun] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [LedgerIntegrityRun_id_df] DEFAULT NEWID(),
    [status] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [checkCount] INT NOT NULL,
    [passedCount] INT NOT NULL,
    [warningCount] INT NOT NULL,
    [criticalCount] INT NOT NULL,
    [snapshotJson] NVARCHAR(MAX) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LedgerIntegrityRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LedgerIntegrityRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [LedgerIntegrityCheck] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [LedgerIntegrityCheck_id_df] DEFAULT NEWID(),
    [runId] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(MAX) NOT NULL,
    [observed] NVARCHAR(MAX),
    [expected] NVARCHAR(MAX),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LedgerIntegrityCheck_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LedgerIntegrityCheck_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LedgerIntegrityCheck_runId_fkey] FOREIGN KEY ([runId]) REFERENCES [LedgerIntegrityRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [ReleaseEvidenceBundle] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [ReleaseEvidenceBundle_id_df] DEFAULT NEWID(),
    [version] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [readinessStatus] NVARCHAR(1000) NOT NULL,
    [externalStatus] NVARCHAR(1000) NOT NULL,
    [linuxStatus] NVARCHAR(1000) NOT NULL,
    [soakStatus] NVARCHAR(1000) NOT NULL,
    [faultStatus] NVARCHAR(1000) NOT NULL,
    [ledgerStatus] NVARCHAR(1000) NOT NULL,
    [evidenceJson] NVARCHAR(MAX) NOT NULL,
    [checksum] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ReleaseEvidenceBundle_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ReleaseEvidenceBundle_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [ExternalCertificationRun_certificationType_startedAt_idx] ON [ExternalCertificationRun]([certificationType], [startedAt]);
CREATE INDEX [ExternalCertificationRun_status_startedAt_idx] ON [ExternalCertificationRun]([status], [startedAt]);
CREATE INDEX [CertificationEvidence_category_occurredAt_idx] ON [CertificationEvidence]([category], [occurredAt]);
CREATE INDEX [CertificationEvidence_certificationRunId_occurredAt_idx] ON [CertificationEvidence]([certificationRunId], [occurredAt]);
CREATE INDEX [CertificationEvidence_status_occurredAt_idx] ON [CertificationEvidence]([status], [occurredAt]);
CREATE INDEX [SoakTestRun_status_startedAt_idx] ON [SoakTestRun]([status], [startedAt]);
CREATE UNIQUE INDEX [SoakMetricSample_soakTestRunId_sampledAt_key] ON [SoakMetricSample]([soakTestRunId], [sampledAt]);
CREATE INDEX [SoakMetricSample_soakTestRunId_sampledAt_idx] ON [SoakMetricSample]([soakTestRunId], [sampledAt]);
CREATE INDEX [FaultInjectionRun_scenario_startedAt_idx] ON [FaultInjectionRun]([scenario], [startedAt]);
CREATE INDEX [FaultInjectionRun_status_startedAt_idx] ON [FaultInjectionRun]([status], [startedAt]);
CREATE INDEX [LedgerIntegrityRun_status_startedAt_idx] ON [LedgerIntegrityRun]([status], [startedAt]);
CREATE INDEX [LedgerIntegrityRun_source_startedAt_idx] ON [LedgerIntegrityRun]([source], [startedAt]);
CREATE UNIQUE INDEX [LedgerIntegrityCheck_runId_code_key] ON [LedgerIntegrityCheck]([runId], [code]);
CREATE INDEX [LedgerIntegrityCheck_runId_severity_idx] ON [LedgerIntegrityCheck]([runId], [severity]);
CREATE INDEX [ReleaseEvidenceBundle_version_createdAt_idx] ON [ReleaseEvidenceBundle]([version], [createdAt]);
CREATE INDEX [ReleaseEvidenceBundle_status_createdAt_idx] ON [ReleaseEvidenceBundle]([status], [createdAt]);
