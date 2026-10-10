BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BrokerConnection] (
    [id] NVARCHAR(1000) NOT NULL,
    [provider] NVARCHAR(1000) NOT NULL,
    [displayName] NVARCHAR(1000) NOT NULL,
    [environment] NVARCHAR(1000) NOT NULL,
    [runMode] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerConnection_runMode_df] DEFAULT 'OFFLINE',
    [safetyState] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerConnection_safetyState_df] DEFAULT 'READ_ONLY',
    [connectorUrl] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerConnection_status_df] DEFAULT 'OFFLINE',
    [capabilitiesJson] NVARCHAR(max) NOT NULL,
    [lastConnectedAt] DATETIME2,
    [lastHeartbeatAt] DATETIME2,
    [lastSyncAt] DATETIME2,
    [lastErrorAt] DATETIME2,
    [lastErrorMessage] NVARCHAR(max),
    [enabled] BIT NOT NULL CONSTRAINT [BrokerConnection_enabled_df] DEFAULT 0,
    [autoReconciliation] BIT NOT NULL CONSTRAINT [BrokerConnection_autoReconciliation_df] DEFAULT 0,
    [shadowTradingEnabled] BIT NOT NULL CONSTRAINT [BrokerConnection_shadowTradingEnabled_df] DEFAULT 0,
    [staleAfterSeconds] INT NOT NULL CONSTRAINT [BrokerConnection_staleAfterSeconds_df] DEFAULT 900,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerConnection_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrokerConnection_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerConnectionId] NVARCHAR(1000) NOT NULL,
    [localAccountId] NVARCHAR(1000),
    [externalAccountId] VARCHAR(64) NOT NULL,
    [externalIdFormat] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerAccount_externalIdFormat_df] DEFAULT 'SHA256',
    [maskedAccountNumber] NVARCHAR(1000) NOT NULL,
    [accountType] NVARCHAR(1000) NOT NULL,
    [baseCurrency] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerAccount_baseCurrency_df] DEFAULT 'USD',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerAccount_status_df] DEFAULT 'STALE',
    [lastSyncedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrokerAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerAccount_brokerConnectionId_externalAccountId_key] UNIQUE NONCLUSTERED ([brokerConnectionId],[externalAccountId])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerAccountSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [snapshotTime] DATETIME2 NOT NULL,
    [netLiquidation] DECIMAL(18,4) NOT NULL,
    [totalCash] DECIMAL(18,4) NOT NULL,
    [settledCash] DECIMAL(18,4) NOT NULL,
    [availableFunds] DECIMAL(18,4) NOT NULL,
    [buyingPower] DECIMAL(18,4) NOT NULL,
    [grossPositionValue] DECIMAL(18,4) NOT NULL,
    [realizedPnl] DECIMAL(18,4) NOT NULL,
    [unrealizedPnl] DECIMAL(18,4) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerAccountSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerAccountSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerAccountSnapshot_brokerAccountId_snapshotTime_key] UNIQUE NONCLUSTERED ([brokerAccountId],[snapshotTime])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerCashBalance] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [totalCash] DECIMAL(18,4) NOT NULL,
    [settledCash] DECIMAL(18,4) NOT NULL,
    [availableCash] DECIMAL(18,4) NOT NULL,
    [snapshotTime] DATETIME2 NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerCashBalance_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerCashBalance_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerCashBalance_brokerAccountId_currency_snapshotTime_key] UNIQUE NONCLUSTERED ([brokerAccountId],[currency],[snapshotTime])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPositionSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000),
    [externalContractId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [averageCost] DECIMAL(18,6) NOT NULL,
    [marketPrice] DECIMAL(18,6) NOT NULL,
    [marketValue] DECIMAL(18,4) NOT NULL,
    [unrealizedPnl] DECIMAL(18,4) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [mappingStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerPositionSnapshot_mappingStatus_df] DEFAULT 'MAPPED',
    [snapshotTime] DATETIME2 NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPositionSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerPositionSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerPositionSnapshot_brokerAccountId_symbol_snapshotTime_key] UNIQUE NONCLUSTERED ([brokerAccountId],[symbol],[snapshotTime])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerExecution] (
    [id] NVARCHAR(1000) NOT NULL,
    [deduplicationKey] VARCHAR(64) NOT NULL,
    [externalExecutionId] NVARCHAR(1000),
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000),
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [price] DECIMAL(18,6) NOT NULL,
    [commission] DECIMAL(18,4) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [executionTime] DATETIME2 NOT NULL,
    [tradeDate] DATETIME2 NOT NULL,
    [exchange] NVARCHAR(1000) NOT NULL,
    [orderReference] NVARCHAR(1000),
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [reviewStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerExecution_reviewStatus_df] DEFAULT 'ACCEPTED',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerExecution_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerExecution_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerExecution_deduplicationKey_key] UNIQUE NONCLUSTERED ([deduplicationKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerOrderSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [deduplicationKey] VARCHAR(64) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [externalOrderId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [orderType] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [filledQuantity] DECIMAL(18,6) NOT NULL,
    [limitPrice] DECIMAL(18,6),
    [averageFillPrice] DECIMAL(18,6),
    [currency] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [orderTime] DATETIME2 NOT NULL,
    [snapshotTime] DATETIME2 NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerOrderSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerOrderSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerOrderSnapshot_deduplicationKey_key] UNIQUE NONCLUSTERED ([deduplicationKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerCorporateAction] (
    [id] NVARCHAR(1000) NOT NULL,
    [deduplicationKey] VARCHAR(64) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [externalActionId] NVARCHAR(1000),
    [symbol] NVARCHAR(1000) NOT NULL,
    [actionType] NVARCHAR(1000) NOT NULL,
    [actionDate] DATETIME2 NOT NULL,
    [ratio] DECIMAL(18,8),
    [amount] DECIMAL(18,4),
    [currency] NVARCHAR(1000) NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [reviewStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerCorporateAction_reviewStatus_df] DEFAULT 'ACCEPTED',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerCorporateAction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerCorporateAction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerCorporateAction_deduplicationKey_key] UNIQUE NONCLUSTERED ([deduplicationKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerSyncJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerConnectionId] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerSyncJob_status_df] DEFAULT 'PENDING',
    [requestedFrom] DATETIME2,
    [requestedTo] DATETIME2,
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [retryCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_retryCount_df] DEFAULT 0,
    [accountCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_accountCount_df] DEFAULT 0,
    [snapshotCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_snapshotCount_df] DEFAULT 0,
    [positionCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_positionCount_df] DEFAULT 0,
    [executionCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_executionCount_df] DEFAULT 0,
    [orderCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_orderCount_df] DEFAULT 0,
    [corporateActionCount] INT NOT NULL CONSTRAINT [BrokerSyncJob_corporateActionCount_df] DEFAULT 0,
    [errorMessage] NVARCHAR(max),
    [resultJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerSyncJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrokerSyncJob_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerSyncJob_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerSyncRecord] (
    [id] NVARCHAR(1000) NOT NULL,
    [syncJobId] NVARCHAR(1000) NOT NULL,
    [recordType] NVARCHAR(1000) NOT NULL,
    [externalKey] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(max),
    [payloadHash] VARCHAR(64),
    [reviewStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerSyncRecord_reviewStatus_df] DEFAULT 'ACCEPTED',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerSyncRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerSyncRecord_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountReconciliationRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [localAccountId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [AccountReconciliationRun_status_df] DEFAULT 'PENDING',
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [brokerSnapshotTime] DATETIME2 NOT NULL,
    [localSnapshotTime] DATETIME2 NOT NULL,
    [differenceCount] INT NOT NULL CONSTRAINT [AccountReconciliationRun_differenceCount_df] DEFAULT 0,
    [criticalDifferenceCount] INT NOT NULL CONSTRAINT [AccountReconciliationRun_criticalDifferenceCount_df] DEFAULT 0,
    [summaryJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountReconciliationRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AccountReconciliationRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountReconciliationDifference] (
    [id] NVARCHAR(1000) NOT NULL,
    [reconciliationRunId] NVARCHAR(1000) NOT NULL,
    [differenceType] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000),
    [fieldName] NVARCHAR(1000) NOT NULL,
    [brokerValue] NVARCHAR(1000),
    [localValue] NVARCHAR(1000),
    [absoluteDifference] DECIMAL(18,6),
    [percentageDifference] DECIMAL(18,6),
    [severity] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [AccountReconciliationDifference_status_df] DEFAULT 'OPEN',
    [suggestedAction] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountReconciliationDifference_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt] DATETIME2,
    CONSTRAINT [AccountReconciliationDifference_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ReconciliationDecision] (
    [id] NVARCHAR(1000) NOT NULL,
    [reconciliationRunId] NVARCHAR(1000) NOT NULL,
    [reconciliationDifferenceId] NVARCHAR(1000) NOT NULL,
    [decision] NVARCHAR(1000) NOT NULL,
    [operatorId] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(max) NOT NULL,
    [originalValue] NVARCHAR(1000),
    [acceptedValue] NVARCHAR(1000),
    [adjustmentJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ReconciliationDecision_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ReconciliationDecision_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ShadowTradingSession] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [localAccountId] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000),
    [portfolioId] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ShadowTradingSession_status_df] DEFAULT 'OBSERVING',
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [brokerSnapshotTime] DATETIME2 NOT NULL,
    [initialEquity] DECIMAL(18,4) NOT NULL,
    [initialCash] DECIMAL(18,4) NOT NULL,
    [currentEquity] DECIMAL(18,4) NOT NULL,
    [currentCash] DECIMAL(18,4) NOT NULL,
    [idempotencyKey] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShadowTradingSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShadowTradingSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShadowTradingSession_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[ShadowSignal] (
    [id] NVARCHAR(1000) NOT NULL,
    [shadowSessionId] NVARCHAR(1000) NOT NULL,
    [strategySignalId] NVARCHAR(1000),
    [strategyId] NVARCHAR(1000),
    [symbol] NVARCHAR(1000) NOT NULL,
    [signalDate] DATETIME2 NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [referencePrice] DECIMAL(18,6) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [riskDecisionJson] NVARCHAR(max),
    [idempotencyKey] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShadowSignal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShadowSignal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShadowSignal_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[ShadowOrderIntent] (
    [id] NVARCHAR(1000) NOT NULL,
    [shadowSessionId] NVARCHAR(1000) NOT NULL,
    [shadowSignalId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [theoreticalPrice] DECIMAL(18,6) NOT NULL,
    [theoreticalOrderAt] DATETIME2 NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [singleRiskJson] NVARCHAR(max) NOT NULL,
    [portfolioRiskJson] NVARCHAR(max),
    [rejectionReason] NVARCHAR(max),
    [idempotencyKey] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShadowOrderIntent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShadowOrderIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShadowOrderIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[ShadowFill] (
    [id] NVARCHAR(1000) NOT NULL,
    [shadowSessionId] NVARCHAR(1000) NOT NULL,
    [shadowOrderIntentId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [fillPrice] DECIMAL(18,6) NOT NULL,
    [commission] DECIMAL(18,4) NOT NULL,
    [slippage] DECIMAL(18,4) NOT NULL,
    [fillTime] DATETIME2 NOT NULL,
    [marketDataSource] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShadowFill_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShadowFill_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShadowFill_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[ShadowPerformanceSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [shadowSessionId] NVARCHAR(1000) NOT NULL,
    [snapshotTime] DATETIME2 NOT NULL,
    [totalEquity] DECIMAL(18,4) NOT NULL,
    [cashBalance] DECIMAL(18,4) NOT NULL,
    [totalReturn] DECIMAL(18,8) NOT NULL,
    [maxDrawdown] DECIMAL(18,8) NOT NULL,
    [realizedPnl] DECIMAL(18,4) NOT NULL,
    [unrealizedPnl] DECIMAL(18,4) NOT NULL,
    [benchmarkReturn] DECIMAL(18,8),
    [paperDeviation] DECIMAL(18,8),
    [manualTradeDeviation] DECIMAL(18,8),
    [opportunityPnl] DECIMAL(18,4),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShadowPerformanceSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShadowPerformanceSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShadowPerformanceSnapshot_shadowSessionId_snapshotTime_key] UNIQUE NONCLUSTERED ([shadowSessionId],[snapshotTime])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerAuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerConnectionId] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000),
    [syncJobId] NVARCHAR(1000),
    [reconciliationRunId] NVARCHAR(1000),
    [shadowTradingSessionId] NVARCHAR(1000),
    [eventType] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerAuditLog_severity_df] DEFAULT 'INFO',
    [actorId] NVARCHAR(1000),
    [message] NVARCHAR(max) NOT NULL,
    [detailsJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerAuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerAuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerConnection_provider_environment_idx] ON [dbo].[BrokerConnection]([provider], [environment]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerConnection_status_enabled_idx] ON [dbo].[BrokerConnection]([status], [enabled]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAccount_localAccountId_idx] ON [dbo].[BrokerAccount]([localAccountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAccount_status_lastSyncedAt_idx] ON [dbo].[BrokerAccount]([status], [lastSyncedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAccountSnapshot_brokerAccountId_snapshotTime_idx] ON [dbo].[BrokerAccountSnapshot]([brokerAccountId], [snapshotTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAccountSnapshot_syncJobId_idx] ON [dbo].[BrokerAccountSnapshot]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerCashBalance_syncJobId_idx] ON [dbo].[BrokerCashBalance]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPositionSnapshot_instrumentId_idx] ON [dbo].[BrokerPositionSnapshot]([instrumentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPositionSnapshot_syncJobId_idx] ON [dbo].[BrokerPositionSnapshot]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerExecution_brokerAccountId_executionTime_idx] ON [dbo].[BrokerExecution]([brokerAccountId], [executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerExecution_syncJobId_idx] ON [dbo].[BrokerExecution]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderSnapshot_brokerAccountId_snapshotTime_idx] ON [dbo].[BrokerOrderSnapshot]([brokerAccountId], [snapshotTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderSnapshot_syncJobId_idx] ON [dbo].[BrokerOrderSnapshot]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerCorporateAction_brokerAccountId_actionDate_idx] ON [dbo].[BrokerCorporateAction]([brokerAccountId], [actionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerCorporateAction_syncJobId_idx] ON [dbo].[BrokerCorporateAction]([syncJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerSyncJob_brokerConnectionId_createdAt_idx] ON [dbo].[BrokerSyncJob]([brokerConnectionId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerSyncJob_status_createdAt_idx] ON [dbo].[BrokerSyncJob]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerSyncRecord_syncJobId_recordType_idx] ON [dbo].[BrokerSyncRecord]([syncJobId], [recordType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerSyncRecord_reviewStatus_createdAt_idx] ON [dbo].[BrokerSyncRecord]([reviewStatus], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountReconciliationRun_brokerAccountId_createdAt_idx] ON [dbo].[AccountReconciliationRun]([brokerAccountId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountReconciliationRun_localAccountId_createdAt_idx] ON [dbo].[AccountReconciliationRun]([localAccountId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountReconciliationDifference_reconciliationRunId_status_idx] ON [dbo].[AccountReconciliationDifference]([reconciliationRunId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountReconciliationDifference_severity_status_idx] ON [dbo].[AccountReconciliationDifference]([severity], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReconciliationDecision_reconciliationRunId_createdAt_idx] ON [dbo].[ReconciliationDecision]([reconciliationRunId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReconciliationDecision_reconciliationDifferenceId_createdAt_idx] ON [dbo].[ReconciliationDecision]([reconciliationDifferenceId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowTradingSession_brokerAccountId_startedAt_idx] ON [dbo].[ShadowTradingSession]([brokerAccountId], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowTradingSession_status_startedAt_idx] ON [dbo].[ShadowTradingSession]([status], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowSignal_shadowSessionId_signalDate_idx] ON [dbo].[ShadowSignal]([shadowSessionId], [signalDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowOrderIntent_shadowSessionId_theoreticalOrderAt_idx] ON [dbo].[ShadowOrderIntent]([shadowSessionId], [theoreticalOrderAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowOrderIntent_status_theoreticalOrderAt_idx] ON [dbo].[ShadowOrderIntent]([status], [theoreticalOrderAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShadowFill_shadowSessionId_fillTime_idx] ON [dbo].[ShadowFill]([shadowSessionId], [fillTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAuditLog_brokerConnectionId_createdAt_idx] ON [dbo].[BrokerAuditLog]([brokerConnectionId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerAuditLog_eventType_severity_createdAt_idx] ON [dbo].[BrokerAuditLog]([eventType], [severity], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAccount] ADD CONSTRAINT [BrokerAccount_brokerConnectionId_fkey] FOREIGN KEY ([brokerConnectionId]) REFERENCES [dbo].[BrokerConnection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAccountSnapshot] ADD CONSTRAINT [BrokerAccountSnapshot_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAccountSnapshot] ADD CONSTRAINT [BrokerAccountSnapshot_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerCashBalance] ADD CONSTRAINT [BrokerCashBalance_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerCashBalance] ADD CONSTRAINT [BrokerCashBalance_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPositionSnapshot] ADD CONSTRAINT [BrokerPositionSnapshot_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPositionSnapshot] ADD CONSTRAINT [BrokerPositionSnapshot_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerExecution] ADD CONSTRAINT [BrokerExecution_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerExecution] ADD CONSTRAINT [BrokerExecution_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerOrderSnapshot] ADD CONSTRAINT [BrokerOrderSnapshot_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerOrderSnapshot] ADD CONSTRAINT [BrokerOrderSnapshot_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerCorporateAction] ADD CONSTRAINT [BrokerCorporateAction_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerCorporateAction] ADD CONSTRAINT [BrokerCorporateAction_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerSyncJob] ADD CONSTRAINT [BrokerSyncJob_brokerConnectionId_fkey] FOREIGN KEY ([brokerConnectionId]) REFERENCES [dbo].[BrokerConnection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerSyncRecord] ADD CONSTRAINT [BrokerSyncRecord_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountReconciliationRun] ADD CONSTRAINT [AccountReconciliationRun_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountReconciliationDifference] ADD CONSTRAINT [AccountReconciliationDifference_reconciliationRunId_fkey] FOREIGN KEY ([reconciliationRunId]) REFERENCES [dbo].[AccountReconciliationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReconciliationDecision] ADD CONSTRAINT [ReconciliationDecision_reconciliationRunId_fkey] FOREIGN KEY ([reconciliationRunId]) REFERENCES [dbo].[AccountReconciliationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReconciliationDecision] ADD CONSTRAINT [ReconciliationDecision_reconciliationDifferenceId_fkey] FOREIGN KEY ([reconciliationDifferenceId]) REFERENCES [dbo].[AccountReconciliationDifference]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowTradingSession] ADD CONSTRAINT [ShadowTradingSession_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowSignal] ADD CONSTRAINT [ShadowSignal_shadowSessionId_fkey] FOREIGN KEY ([shadowSessionId]) REFERENCES [dbo].[ShadowTradingSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowOrderIntent] ADD CONSTRAINT [ShadowOrderIntent_shadowSessionId_fkey] FOREIGN KEY ([shadowSessionId]) REFERENCES [dbo].[ShadowTradingSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowOrderIntent] ADD CONSTRAINT [ShadowOrderIntent_shadowSignalId_fkey] FOREIGN KEY ([shadowSignalId]) REFERENCES [dbo].[ShadowSignal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowFill] ADD CONSTRAINT [ShadowFill_shadowSessionId_fkey] FOREIGN KEY ([shadowSessionId]) REFERENCES [dbo].[ShadowTradingSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowFill] ADD CONSTRAINT [ShadowFill_shadowOrderIntentId_fkey] FOREIGN KEY ([shadowOrderIntentId]) REFERENCES [dbo].[ShadowOrderIntent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShadowPerformanceSnapshot] ADD CONSTRAINT [ShadowPerformanceSnapshot_shadowSessionId_fkey] FOREIGN KEY ([shadowSessionId]) REFERENCES [dbo].[ShadowTradingSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAuditLog] ADD CONSTRAINT [BrokerAuditLog_brokerConnectionId_fkey] FOREIGN KEY ([brokerConnectionId]) REFERENCES [dbo].[BrokerConnection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAuditLog] ADD CONSTRAINT [BrokerAuditLog_brokerAccountId_fkey] FOREIGN KEY ([brokerAccountId]) REFERENCES [dbo].[BrokerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAuditLog] ADD CONSTRAINT [BrokerAuditLog_syncJobId_fkey] FOREIGN KEY ([syncJobId]) REFERENCES [dbo].[BrokerSyncJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAuditLog] ADD CONSTRAINT [BrokerAuditLog_reconciliationRunId_fkey] FOREIGN KEY ([reconciliationRunId]) REFERENCES [dbo].[AccountReconciliationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerAuditLog] ADD CONSTRAINT [BrokerAuditLog_shadowTradingSessionId_fkey] FOREIGN KEY ([shadowTradingSessionId]) REFERENCES [dbo].[ShadowTradingSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
