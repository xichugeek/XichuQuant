BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BrokerOrderProposal] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000),
    [strategyDeploymentId] NVARCHAR(1000),
    [strategyVersion] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000),
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [contractId] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [orderType] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [limitPrice] DECIMAL(18,6),
    [stopPrice] DECIMAL(18,6),
    [timeInForce] NVARCHAR(1000) NOT NULL,
    [outsideRth] BIT NOT NULL CONSTRAINT [BrokerOrderProposal_outsideRth_df] DEFAULT 0,
    [allowPartialFill] BIT NOT NULL CONSTRAINT [BrokerOrderProposal_allowPartialFill_df] DEFAULT 1,
    [maxSlippage] DECIMAL(18,6) NOT NULL,
    [expirationTime] DATETIME2 NOT NULL,
    [estimatedValue] DECIMAL(18,4) NOT NULL,
    [estimatedCommission] DECIMAL(18,4) NOT NULL,
    [signalId] NVARCHAR(1000),
    [riskDecisionId] NVARCHAR(1000) NOT NULL,
    [portfolioRiskDecisionId] NVARCHAR(1000),
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [proposalVersion] INT NOT NULL CONSTRAINT [BrokerOrderProposal_proposalVersion_df] DEFAULT 1,
    [proposalSnapshotJson] NVARCHAR(max) NOT NULL,
    [proposalHash] VARCHAR(64) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerOrderProposal_status_df] DEFAULT 'DRAFT',
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerOrderProposal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrokerOrderProposal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerOrderProposal_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerOrderApproval] (
    [id] NVARCHAR(1000) NOT NULL,
    [proposalId] NVARCHAR(1000) NOT NULL,
    [actorId] NVARCHAR(1000) NOT NULL,
    [decision] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(max) NOT NULL,
    [proposalSnapshotHash] VARCHAR(64) NOT NULL,
    [confirmationHash] VARCHAR(64) NOT NULL,
    [approvedAt] DATETIME2,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerOrderApproval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerOrderApproval_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperOrder] (
    [id] NVARCHAR(1000) NOT NULL,
    [proposalId] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [externalOrderId] NVARCHAR(1000),
    [externalPermanentId] NVARCHAR(1000),
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [orderType] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [limitPrice] DECIMAL(18,6),
    [stopPrice] DECIMAL(18,6),
    [timeInForce] NVARCHAR(1000) NOT NULL,
    [outsideRth] BIT NOT NULL CONSTRAINT [BrokerPaperOrder_outsideRth_df] DEFAULT 0,
    [allowPartialFill] BIT NOT NULL CONSTRAINT [BrokerPaperOrder_allowPartialFill_df] DEFAULT 1,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerPaperOrder_status_df] DEFAULT 'CREATED',
    [filledQuantity] DECIMAL(18,6) NOT NULL CONSTRAINT [BrokerPaperOrder_filledQuantity_df] DEFAULT 0,
    [remainingQuantity] DECIMAL(18,6) NOT NULL,
    [averageFillPrice] DECIMAL(18,6),
    [lastFillPrice] DECIMAL(18,6),
    [submissionAttempt] INT NOT NULL CONSTRAINT [BrokerPaperOrder_submissionAttempt_df] DEFAULT 0,
    [submittedAt] DATETIME2,
    [latestStatusAt] DATETIME2,
    [errorMessage] NVARCHAR(max),
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrokerPaperOrder_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerPaperOrder_proposalId_key] UNIQUE NONCLUSTERED ([proposalId]),
    CONSTRAINT [BrokerPaperOrder_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperOrderEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerPaperOrderId] NVARCHAR(1000) NOT NULL,
    [externalOrderId] NVARCHAR(1000),
    [externalPermanentId] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL,
    [filledQuantity] DECIMAL(18,6) NOT NULL,
    [remainingQuantity] DECIMAL(18,6) NOT NULL,
    [averageFillPrice] DECIMAL(18,6),
    [lastFillPrice] DECIMAL(18,6),
    [reason] NVARCHAR(max),
    [eventTime] DATETIME2 NOT NULL,
    [connectorVersion] NVARCHAR(1000) NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperOrderEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerPaperOrderEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperExecution] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerPaperOrderId] NVARCHAR(1000) NOT NULL,
    [externalExecutionId] NVARCHAR(1000),
    [deduplicationKey] VARCHAR(64) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [price] DECIMAL(18,6) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [executionTime] DATETIME2 NOT NULL,
    [exchange] NVARCHAR(1000) NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperExecution_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerPaperExecution_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerPaperExecution_deduplicationKey_key] UNIQUE NONCLUSTERED ([deduplicationKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperCommission] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerPaperExecutionId] NVARCHAR(1000) NOT NULL,
    [deduplicationKey] VARCHAR(64) NOT NULL,
    [externalReportId] NVARCHAR(1000),
    [amount] DECIMAL(18,4) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [realizedPnl] DECIMAL(18,4),
    [reportTime] DATETIME2 NOT NULL,
    [rawDataHash] VARCHAR(64) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperCommission_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerPaperCommission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BrokerPaperCommission_deduplicationKey_key] UNIQUE NONCLUSTERED ([deduplicationKey])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperReconciliationRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [brokerPaperOrderId] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerPaperReconciliationRun_status_df] DEFAULT 'PENDING',
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [differenceCount] INT NOT NULL CONSTRAINT [BrokerPaperReconciliationRun_differenceCount_df] DEFAULT 0,
    [criticalDifferenceCount] INT NOT NULL CONSTRAINT [BrokerPaperReconciliationRun_criticalDifferenceCount_df] DEFAULT 0,
    [summaryJson] NVARCHAR(max) NOT NULL,
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperReconciliationRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerPaperReconciliationRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerPaperReconciliationDifference] (
    [id] NVARCHAR(1000) NOT NULL,
    [reconciliationRunId] NVARCHAR(1000) NOT NULL,
    [brokerPaperOrderId] NVARCHAR(1000),
    [differenceType] NVARCHAR(1000) NOT NULL,
    [fieldName] NVARCHAR(1000) NOT NULL,
    [brokerValue] NVARCHAR(1000),
    [localValue] NVARCHAR(1000),
    [differenceValue] NVARCHAR(1000),
    [severity] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(max) NOT NULL,
    [suggestedAction] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerPaperReconciliationDifference_status_df] DEFAULT 'OPEN',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerPaperReconciliationDifference_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt] DATETIME2,
    CONSTRAINT [BrokerPaperReconciliationDifference_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ExecutionGuardDecision] (
    [id] NVARCHAR(1000) NOT NULL,
    [proposalId] NVARCHAR(1000) NOT NULL,
    [decision] NVARCHAR(1000) NOT NULL,
    [checksJson] NVARCHAR(max) NOT NULL,
    [reason] NVARCHAR(max),
    [marketDataTime] DATETIME2,
    [accountSnapshotTime] DATETIME2,
    [correlationId] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ExecutionGuardDecision_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ExecutionGuardDecision_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ExecutionIncident] (
    [id] NVARCHAR(1000) NOT NULL,
    [proposalId] NVARCHAR(1000),
    [brokerPaperOrderId] NVARCHAR(1000),
    [brokerAccountId] NVARCHAR(1000),
    [incidentType] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL,
    [impact] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ExecutionIncident_status_df] DEFAULT 'OPEN',
    [actionTaken] NVARCHAR(max),
    [rootCause] NVARCHAR(max),
    [followUpRule] NVARCHAR(max),
    [correlationId] VARCHAR(64) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [resolvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ExecutionIncident_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ExecutionIncident_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BrokerExecutionControl] (
    [id] NVARCHAR(1000) NOT NULL,
    [killSwitchLevel] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerExecutionControl_killSwitchLevel_df] DEFAULT 'LEVEL_0_NORMAL',
    [safetyState] NVARCHAR(1000) NOT NULL CONSTRAINT [BrokerExecutionControl_safetyState_df] DEFAULT 'READ_ONLY',
    [reason] NVARCHAR(max),
    [operatorId] NVARCHAR(1000),
    [previousStateJson] NVARCHAR(max),
    [confirmationHash] VARCHAR(64),
    [updatedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BrokerExecutionControl_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BrokerExecutionControl_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BackupRecoveryRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [operation] NVARCHAR(1000) NOT NULL,
    [targetDatabase] NVARCHAR(1000) NOT NULL,
    [backupReferenceHash] VARCHAR(64),
    [status] NVARCHAR(1000) NOT NULL,
    [actorId] NVARCHAR(1000) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [verificationJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BackupRecoveryRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BackupRecoveryRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderProposal_brokerAccountId_status_createdAt_idx] ON [dbo].[BrokerOrderProposal]([brokerAccountId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderProposal_strategyId_createdAt_idx] ON [dbo].[BrokerOrderProposal]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderProposal_portfolioId_createdAt_idx] ON [dbo].[BrokerOrderProposal]([portfolioId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderProposal_correlationId_idx] ON [dbo].[BrokerOrderProposal]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderApproval_proposalId_createdAt_idx] ON [dbo].[BrokerOrderApproval]([proposalId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerOrderApproval_actorId_createdAt_idx] ON [dbo].[BrokerOrderApproval]([actorId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrder_brokerAccountId_status_createdAt_idx] ON [dbo].[BrokerPaperOrder]([brokerAccountId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrder_externalOrderId_idx] ON [dbo].[BrokerPaperOrder]([externalOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrder_externalPermanentId_idx] ON [dbo].[BrokerPaperOrder]([externalPermanentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrder_correlationId_idx] ON [dbo].[BrokerPaperOrder]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrderEvent_brokerPaperOrderId_eventTime_idx] ON [dbo].[BrokerPaperOrderEvent]([brokerPaperOrderId], [eventTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrderEvent_externalOrderId_eventTime_idx] ON [dbo].[BrokerPaperOrderEvent]([externalOrderId], [eventTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrderEvent_correlationId_idx] ON [dbo].[BrokerPaperOrderEvent]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperExecution_brokerPaperOrderId_executionTime_idx] ON [dbo].[BrokerPaperExecution]([brokerPaperOrderId], [executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperExecution_externalExecutionId_idx] ON [dbo].[BrokerPaperExecution]([externalExecutionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperExecution_correlationId_idx] ON [dbo].[BrokerPaperExecution]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperCommission_brokerPaperExecutionId_reportTime_idx] ON [dbo].[BrokerPaperCommission]([brokerPaperExecutionId], [reportTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperCommission_correlationId_idx] ON [dbo].[BrokerPaperCommission]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperReconciliationRun_brokerAccountId_createdAt_idx] ON [dbo].[BrokerPaperReconciliationRun]([brokerAccountId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperReconciliationRun_brokerPaperOrderId_createdAt_idx] ON [dbo].[BrokerPaperReconciliationRun]([brokerPaperOrderId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperReconciliationRun_status_createdAt_idx] ON [dbo].[BrokerPaperReconciliationRun]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperReconciliationDifference_reconciliationRunId_severity_idx] ON [dbo].[BrokerPaperReconciliationDifference]([reconciliationRunId], [severity]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperReconciliationDifference_brokerPaperOrderId_status_idx] ON [dbo].[BrokerPaperReconciliationDifference]([brokerPaperOrderId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionGuardDecision_proposalId_createdAt_idx] ON [dbo].[ExecutionGuardDecision]([proposalId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionGuardDecision_decision_createdAt_idx] ON [dbo].[ExecutionGuardDecision]([decision], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionGuardDecision_correlationId_idx] ON [dbo].[ExecutionGuardDecision]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionIncident_incidentType_severity_occurredAt_idx] ON [dbo].[ExecutionIncident]([incidentType], [severity], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionIncident_brokerAccountId_occurredAt_idx] ON [dbo].[ExecutionIncident]([brokerAccountId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExecutionIncident_correlationId_idx] ON [dbo].[ExecutionIncident]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackupRecoveryRun_operation_startedAt_idx] ON [dbo].[BackupRecoveryRun]([operation], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackupRecoveryRun_status_startedAt_idx] ON [dbo].[BackupRecoveryRun]([status], [startedAt]);

-- AddForeignKey
ALTER TABLE [dbo].[BrokerOrderApproval] ADD CONSTRAINT [BrokerOrderApproval_proposalId_fkey] FOREIGN KEY ([proposalId]) REFERENCES [dbo].[BrokerOrderProposal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperOrder] ADD CONSTRAINT [BrokerPaperOrder_proposalId_fkey] FOREIGN KEY ([proposalId]) REFERENCES [dbo].[BrokerOrderProposal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperOrderEvent] ADD CONSTRAINT [BrokerPaperOrderEvent_brokerPaperOrderId_fkey] FOREIGN KEY ([brokerPaperOrderId]) REFERENCES [dbo].[BrokerPaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperExecution] ADD CONSTRAINT [BrokerPaperExecution_brokerPaperOrderId_fkey] FOREIGN KEY ([brokerPaperOrderId]) REFERENCES [dbo].[BrokerPaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperCommission] ADD CONSTRAINT [BrokerPaperCommission_brokerPaperExecutionId_fkey] FOREIGN KEY ([brokerPaperExecutionId]) REFERENCES [dbo].[BrokerPaperExecution]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperReconciliationDifference] ADD CONSTRAINT [BrokerPaperReconciliationDifference_reconciliationRunId_fkey] FOREIGN KEY ([reconciliationRunId]) REFERENCES [dbo].[BrokerPaperReconciliationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BrokerPaperReconciliationDifference] ADD CONSTRAINT [BrokerPaperReconciliationDifference_brokerPaperOrderId_fkey] FOREIGN KEY ([brokerPaperOrderId]) REFERENCES [dbo].[BrokerPaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExecutionGuardDecision] ADD CONSTRAINT [ExecutionGuardDecision_proposalId_fkey] FOREIGN KEY ([proposalId]) REFERENCES [dbo].[BrokerOrderProposal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExecutionIncident] ADD CONSTRAINT [ExecutionIncident_proposalId_fkey] FOREIGN KEY ([proposalId]) REFERENCES [dbo].[BrokerOrderProposal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExecutionIncident] ADD CONSTRAINT [ExecutionIncident_brokerPaperOrderId_fkey] FOREIGN KEY ([brokerPaperOrderId]) REFERENCES [dbo].[BrokerPaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
