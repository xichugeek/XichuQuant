BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Instrument] ADD
    [underlyingSymbol] NVARCHAR(1000),
    [riskTheme] NVARCHAR(1000),
    [sector] NVARCHAR(1000),
    [industry] NVARCHAR(1000),
    [leverageMultiplier] DECIMAL(8,4) NOT NULL CONSTRAINT [Instrument_leverageMultiplier_df] DEFAULT 1,
    [direction] NVARCHAR(1000) NOT NULL CONSTRAINT [Instrument_direction_df] DEFAULT 'LONG',
    [leveragedETF] BIT NOT NULL CONSTRAINT [Instrument_leveragedETF_df] DEFAULT 0;

ALTER TABLE [dbo].[BrokerOrderProposal] ADD
    [entryPrice] DECIMAL(18,6),
    [plannedStopPrice] DECIMAL(18,6),
    [exitCondition] NVARCHAR(1000),
    [plannedLoss] DECIMAL(18,4),
    [plannedLossPct] DECIMAL(10,6),
    [allowOvernight] BIT,
    [gapStressJson] NVARCHAR(MAX),
    [predefinedScalePlanId] NVARCHAR(1000),
    [predefinedScaleVersion] INT;

CREATE TABLE [dbo].[PredefinedScalePlan] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PredefinedScalePlan_status_df] DEFAULT 'APPROVED',
    [tranchesJson] NVARCHAR(MAX) NOT NULL,
    [maxTotalQuantity] DECIMAL(18,6) NOT NULL,
    [maxPrincipalPercent] DECIMAL(10,6) NOT NULL,
    [finalStopPrice] DECIMAL(18,6) NOT NULL,
    [maxAccountRiskPct] DECIMAL(10,6) NOT NULL,
    [allowOvernight] BIT NOT NULL,
    [planHash] VARCHAR(64) NOT NULL,
    [createdBy] NVARCHAR(1000) NOT NULL,
    [approvalChainJson] NVARCHAR(MAX) NOT NULL,
    [approvedAt] DATETIME2 NOT NULL,
    [firstFilledAt] DATETIME2,
    [lockedAt] DATETIME2,
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PredefinedScalePlan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PredefinedScalePlan_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [PredefinedScalePlan_brokerAccountId_symbol_version_key]
ON [dbo].[PredefinedScalePlan]([brokerAccountId], [symbol], [version]);
CREATE NONCLUSTERED INDEX [PredefinedScalePlan_brokerAccountId_symbol_status_idx]
ON [dbo].[PredefinedScalePlan]([brokerAccountId], [symbol], [status]);
CREATE NONCLUSTERED INDEX [PredefinedScalePlan_planHash_idx]
ON [dbo].[PredefinedScalePlan]([planHash]);

CREATE TABLE [dbo].[RiskDisciplineEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [brokerAccountId] NVARCHAR(1000),
    [proposalId] NVARCHAR(1000),
    [brokerPaperOrderId] NVARCHAR(1000),
    [positionIncidentId] NVARCHAR(1000),
    [eventType] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL,
    [ruleCode] NVARCHAR(1000) NOT NULL,
    [decision] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(MAX) NOT NULL,
    [oldValueJson] NVARCHAR(MAX),
    [newValueJson] NVARCHAR(MAX),
    [actorId] NVARCHAR(1000) NOT NULL,
    [approvalChainJson] NVARCHAR(MAX),
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RiskDisciplineEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RiskDisciplineEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE NONCLUSTERED INDEX [RiskDisciplineEvent_idempotencyKey_key]
ON [dbo].[RiskDisciplineEvent]([idempotencyKey]);
CREATE NONCLUSTERED INDEX [RiskDisciplineEvent_brokerAccountId_occurredAt_idx]
ON [dbo].[RiskDisciplineEvent]([brokerAccountId], [occurredAt]);
CREATE NONCLUSTERED INDEX [RiskDisciplineEvent_proposalId_occurredAt_idx]
ON [dbo].[RiskDisciplineEvent]([proposalId], [occurredAt]);
CREATE NONCLUSTERED INDEX [RiskDisciplineEvent_brokerPaperOrderId_occurredAt_idx]
ON [dbo].[RiskDisciplineEvent]([brokerPaperOrderId], [occurredAt]);
CREATE NONCLUSTERED INDEX [RiskDisciplineEvent_ruleCode_decision_occurredAt_idx]
ON [dbo].[RiskDisciplineEvent]([ruleCode], [decision], [occurredAt]);

CREATE TABLE [dbo].[RiskDisciplineOverride] (
    [id] NVARCHAR(1000) NOT NULL,
    [targetType] NVARCHAR(1000) NOT NULL,
    [targetId] NVARCHAR(1000) NOT NULL,
    [ruleCode] NVARCHAR(1000) NOT NULL,
    [classification] NVARCHAR(1000) NOT NULL CONSTRAINT [RiskDisciplineOverride_classification_df] DEFAULT 'SOFT_WARNING',
    [oldValueJson] NVARCHAR(MAX) NOT NULL,
    [newValueJson] NVARCHAR(MAX) NOT NULL,
    [reason] NVARCHAR(1000) NOT NULL,
    [operatorId] NVARCHAR(1000) NOT NULL,
    [approvalChainJson] NVARCHAR(MAX) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [RiskDisciplineOverride_status_df] DEFAULT 'APPROVED',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RiskDisciplineOverride_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RiskDisciplineOverride_pkey] PRIMARY KEY CLUSTERED ([id])
);
CREATE NONCLUSTERED INDEX [RiskDisciplineOverride_targetType_targetId_createdAt_idx]
ON [dbo].[RiskDisciplineOverride]([targetType], [targetId], [createdAt]);
CREATE NONCLUSTERED INDEX [RiskDisciplineOverride_ruleCode_createdAt_idx]
ON [dbo].[RiskDisciplineOverride]([ruleCode], [createdAt]);

CREATE TABLE [dbo].[ProfitGivebackSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [snapshotDate] DATE NOT NULL,
    [peakYtdPnl] DECIMAL(18,4) NOT NULL,
    [currentYtdPnl] DECIMAL(18,4) NOT NULL,
    [profitGivebackAmount] DECIMAL(18,4) NOT NULL,
    [profitGivebackPct] DECIMAL(10,6) NOT NULL,
    [state] NVARCHAR(1000) NOT NULL,
    [ruleVersion] INT NOT NULL CONSTRAINT [ProfitGivebackSnapshot_ruleVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ProfitGivebackSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ProfitGivebackSnapshot_pkey] PRIMARY KEY CLUSTERED ([id])
);
CREATE UNIQUE NONCLUSTERED INDEX [ProfitGivebackSnapshot_accountId_snapshotDate_key]
ON [dbo].[ProfitGivebackSnapshot]([accountId], [snapshotDate]);
CREATE NONCLUSTERED INDEX [ProfitGivebackSnapshot_accountId_state_snapshotDate_idx]
ON [dbo].[ProfitGivebackSnapshot]([accountId], [state], [snapshotDate]);

CREATE TABLE [dbo].[PositionIncident] (
    [id] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [brokerAccountId] NVARCHAR(1000),
    [localAccountId] NVARCHAR(1000),
    [title] NVARCHAR(1000) NOT NULL,
    [symbolsJson] NVARCHAR(MAX) NOT NULL,
    [riskTheme] NVARCHAR(1000),
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [PositionIncident_source_df] DEFAULT 'IBKR_IMPORT_OHLCV',
    [dataGranularity] NVARCHAR(1000) NOT NULL CONSTRAINT [PositionIncident_dataGranularity_df] DEFAULT 'DAILY_MAE_APPROXIMATION',
    [openedAt] DATETIME2 NOT NULL,
    [firstViolationAt] DATETIME2,
    [closedAt] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PositionIncident_status_df] DEFAULT 'OPEN',
    [finalRealizedPnl] DECIMAL(18,4),
    [maximumUnrealizedLoss] DECIMAL(18,4),
    [maximumFavorableExcursion] DECIMAL(18,4),
    [mfeCaptureRatio] DECIMAL(12,6),
    [maeToRealizedLoss] DECIMAL(12,6),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PositionIncident_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PositionIncident_pkey] PRIMARY KEY CLUSTERED ([id])
);
CREATE UNIQUE NONCLUSTERED INDEX [PositionIncident_idempotencyKey_key]
ON [dbo].[PositionIncident]([idempotencyKey]);
CREATE NONCLUSTERED INDEX [PositionIncident_brokerAccountId_openedAt_idx]
ON [dbo].[PositionIncident]([brokerAccountId], [openedAt]);
CREATE NONCLUSTERED INDEX [PositionIncident_localAccountId_openedAt_idx]
ON [dbo].[PositionIncident]([localAccountId], [openedAt]);
CREATE NONCLUSTERED INDEX [PositionIncident_status_openedAt_idx]
ON [dbo].[PositionIncident]([status], [openedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
