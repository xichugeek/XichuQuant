BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[StrategyPortfolio] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max),
    [baseCurrency] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyPortfolio_baseCurrency_df] DEFAULT 'USD',
    [initialCapital] DECIMAL(20,4) NOT NULL,
    [cashBalance] DECIMAL(20,4) NOT NULL,
    [totalEquity] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [StrategyPortfolio_realizedPnl_df] DEFAULT 0,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [StrategyPortfolio_unrealizedPnl_df] DEFAULT 0,
    [peakEquity] DECIMAL(20,4) NOT NULL,
    [maxDrawdown] DECIMAL(18,8) NOT NULL CONSTRAINT [StrategyPortfolio_maxDrawdown_df] DEFAULT 0,
    [cashReservePercent] DECIMAL(8,4) NOT NULL,
    [allocationMode] NVARCHAR(1000) NOT NULL,
    [rebalanceMode] NVARCHAR(1000) NOT NULL,
    [conflictPolicy] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyPortfolio_conflictPolicy_df] DEFAULT 'NETTING',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyPortfolio_status_df] DEFAULT 'DRAFT',
    [noNewPositions] BIT NOT NULL CONSTRAINT [StrategyPortfolio_noNewPositions_df] DEFAULT 0,
    [readOnlyMode] BIT NOT NULL CONSTRAINT [StrategyPortfolio_readOnlyMode_df] DEFAULT 0,
    [pausedAt] DATETIME2,
    [stoppedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyPortfolio_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategyPortfolio_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioStrategy] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000),
    [priority] INT NOT NULL CONSTRAINT [PortfolioStrategy_priority_df] DEFAULT 100,
    [targetAllocationPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioStrategy_targetAllocationPercent_df] DEFAULT 0,
    [manualAmount] DECIMAL(20,4),
    [maxCapitalPercent] DECIMAL(8,4) NOT NULL,
    [virtualCapital] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioStrategy_virtualCapital_df] DEFAULT 0,
    [virtualCash] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioStrategy_virtualCash_df] DEFAULT 0,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioStrategy_realizedPnl_df] DEFAULT 0,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PortfolioStrategy_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioStrategy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortfolioStrategy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioStrategy_portfolioId_strategyId_key] UNIQUE NONCLUSTERED ([portfolioId],[strategyId])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioAllocationRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL,
    [allocationMode] NVARCHAR(1000) NOT NULL,
    [configurationJson] NVARCHAR(max) NOT NULL,
    [effectiveFrom] DATETIME2 NOT NULL CONSTRAINT [PortfolioAllocationRule_effectiveFrom_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioAllocationRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioAllocationRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioAllocationRule_portfolioId_version_key] UNIQUE NONCLUSTERED ([portfolioId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioRiskRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL,
    [singleStrategyMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_singleStrategyMaxPercent_df] DEFAULT 40,
    [singleSymbolMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_singleSymbolMaxPercent_df] DEFAULT 30,
    [singleThemeMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_singleThemeMaxPercent_df] DEFAULT 40,
    [leveragedEtfMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_leveragedEtfMaxPercent_df] DEFAULT 10,
    [leveragedStrategyMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_leveragedStrategyMaxPercent_df] DEFAULT 20,
    [correlatedStrategiesMaxPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_correlatedStrategiesMaxPercent_df] DEFAULT 50,
    [correlationThreshold] DECIMAL(8,6) NOT NULL CONSTRAINT [PortfolioRiskRule_correlationThreshold_df] DEFAULT 0.8,
    [maxConcurrentPositions] INT NOT NULL CONSTRAINT [PortfolioRiskRule_maxConcurrentPositions_df] DEFAULT 10,
    [minCashPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_minCashPercent_df] DEFAULT 20,
    [maxDailyLossPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_maxDailyLossPercent_df] DEFAULT 3,
    [maxDrawdownPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_maxDrawdownPercent_df] DEFAULT 15,
    [maxLosingStrategies] INT NOT NULL CONSTRAINT [PortfolioRiskRule_maxLosingStrategies_df] DEFAULT 2,
    [maxStrategyDrawdownContributionPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [PortfolioRiskRule_maxStrategyDrawdownContributionPercent_df] DEFAULT 50,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioRiskRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioRiskRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioRiskRule_portfolioId_version_key] UNIQUE NONCLUSTERED ([portfolioId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioEquitySnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [snapshotDate] DATE NOT NULL,
    [totalEquity] DECIMAL(20,4) NOT NULL,
    [cashBalance] DECIMAL(20,4) NOT NULL,
    [positionValue] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [totalReturn] DECIMAL(18,8) NOT NULL,
    [dailyReturn] DECIMAL(18,8) NOT NULL CONSTRAINT [PortfolioEquitySnapshot_dailyReturn_df] DEFAULT 0,
    [drawdown] DECIMAL(18,8) NOT NULL,
    [benchmarkEquity] DECIMAL(20,4),
    [exposureJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioEquitySnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioEquitySnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioEquitySnapshot_portfolioId_snapshotDate_key] UNIQUE NONCLUSTERED ([portfolioId],[snapshotDate])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioRebalanceRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [tradeDate] DATE NOT NULL,
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [runType] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PortfolioRebalanceRun_status_df] DEFAULT 'PREVIEWED',
    [allocationVersion] INT NOT NULL,
    [riskVersion] INT NOT NULL,
    [conflictPolicy] NVARCHAR(1000) NOT NULL,
    [beforeAllocationJson] NVARCHAR(max) NOT NULL,
    [afterAllocationJson] NVARCHAR(max) NOT NULL,
    [rawSignalsJson] NVARCHAR(max) NOT NULL,
    [netIntentsJson] NVARCHAR(max) NOT NULL,
    [estimatedOrdersJson] NVARCHAR(max) NOT NULL,
    [riskResultJson] NVARCHAR(max) NOT NULL,
    [estimatedCommission] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioRebalanceRun_estimatedCommission_df] DEFAULT 0,
    [estimatedCash] DECIMAL(20,4) NOT NULL,
    [previewOnly] BIT NOT NULL CONSTRAINT [PortfolioRebalanceRun_previewOnly_df] DEFAULT 1,
    [errorMessage] NVARCHAR(max),
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioRebalanceRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortfolioRebalanceRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioRebalanceRun_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey]),
    CONSTRAINT [PortfolioRebalanceRun_portfolioId_tradeDate_runType_key] UNIQUE NONCLUSTERED ([portfolioId],[tradeDate],[runType])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioPerformanceAttribution] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000) NOT NULL,
    [attributionDate] DATE NOT NULL,
    [strategyReturn] DECIMAL(18,8) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_strategyReturn_df] DEFAULT 0,
    [allocatedContribution] DECIMAL(18,8) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_allocatedContribution_df] DEFAULT 0,
    [riskContribution] DECIMAL(18,8) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_riskContribution_df] DEFAULT 0,
    [commissionImpact] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_commissionImpact_df] DEFAULT 0,
    [slippageImpact] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_slippageImpact_df] DEFAULT 0,
    [riskOpportunityCost] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_riskOpportunityCost_df] DEFAULT 0,
    [cashDrag] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_cashDrag_df] DEFAULT 0,
    [detailsJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioPerformanceAttribution_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioPerformanceAttribution_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioPerformanceAttribution_portfolioId_portfolioStrategyId_attributionDate_key] UNIQUE NONCLUSTERED ([portfolioId],[portfolioStrategyId],[attributionDate])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioSignalIntent] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000) NOT NULL,
    [rebalanceRunId] NVARCHAR(1000) NOT NULL,
    [strategySignalId] NVARCHAR(1000),
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [tradeDate] DATE NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [originalQuantity] DECIMAL(20,8),
    [originalAmount] DECIMAL(20,4),
    [approvedQuantity] DECIMAL(20,8),
    [allocatedAmount] DECIMAL(20,4),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PortfolioSignalIntent_status_df] DEFAULT 'PENDING',
    [reason] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioSignalIntent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortfolioSignalIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioSignalIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioPosition] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [assetType] NVARCHAR(1000) NOT NULL,
    [theme] NVARCHAR(1000),
    [quantity] DECIMAL(20,8) NOT NULL,
    [avgCost] DECIMAL(20,6) NOT NULL,
    [currentPrice] DECIMAL(20,6) NOT NULL,
    [marketValue] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioPosition_realizedPnl_df] DEFAULT 0,
    [openedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortfolioPosition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioPosition_portfolioId_symbol_key] UNIQUE NONCLUSTERED ([portfolioId],[symbol])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioStrategyPosition] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [avgCost] DECIMAL(20,6) NOT NULL,
    [currentPrice] DECIMAL(20,6) NOT NULL,
    [marketValue] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PortfolioStrategyPosition_realizedPnl_df] DEFAULT 0,
    [openedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortfolioStrategyPosition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioStrategyPosition_portfolioStrategyId_symbol_key] UNIQUE NONCLUSTERED ([portfolioStrategyId],[symbol])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioOrder] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [rebalanceRunId] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [signalTradeDate] DATE NOT NULL,
    [earliestFillDate] DATE,
    [requestedAmount] DECIMAL(20,4),
    [requestedQuantity] DECIMAL(20,8),
    [approvedQuantity] DECIMAL(20,8),
    [referencePrice] DECIMAL(20,6),
    [commissionRate] DECIMAL(12,8) NOT NULL,
    [slippageRate] DECIMAL(12,8) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PortfolioOrder_status_df] DEFAULT 'CREATED',
    [rejectionReason] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [filledAt] DATETIME2,
    [cancelledAt] DATETIME2,
    CONSTRAINT [PortfolioOrder_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioOrder_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioOrderAllocation] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioOrderId] NVARCHAR(1000) NOT NULL,
    [portfolioSignalIntentId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [notionalPercent] DECIMAL(18,8) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioOrderAllocation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioOrderAllocation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioOrderAllocation_portfolioOrderId_portfolioSignalIntentId_key] UNIQUE NONCLUSTERED ([portfolioOrderId],[portfolioSignalIntentId])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioFill] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioOrderId] NVARCHAR(1000) NOT NULL,
    [fillSequence] INT NOT NULL CONSTRAINT [PortfolioFill_fillSequence_df] DEFAULT 1,
    [executionTime] DATETIME2 NOT NULL,
    [price] DECIMAL(20,6) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [notional] DECIMAL(20,4) NOT NULL,
    [commission] DECIMAL(20,4) NOT NULL,
    [slippage] DECIMAL(20,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioFill_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioFill_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioFill_portfolioOrderId_fillSequence_key] UNIQUE NONCLUSTERED ([portfolioOrderId],[fillSequence])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioFillAllocation] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioFillId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000) NOT NULL,
    [portfolioSignalIntentId] NVARCHAR(1000),
    [quantity] DECIMAL(20,8) NOT NULL,
    [notional] DECIMAL(20,4) NOT NULL,
    [commission] DECIMAL(20,4) NOT NULL,
    [slippage] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioFillAllocation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioFillAllocation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioFillAllocation_portfolioFillId_portfolioStrategyId_key] UNIQUE NONCLUSTERED ([portfolioFillId],[portfolioStrategyId])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioCashMovement] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000),
    [portfolioOrderId] NVARCHAR(1000),
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [movementType] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(20,4) NOT NULL,
    [balanceAfter] DECIMAL(20,4) NOT NULL,
    [description] NVARCHAR(max),
    [eventTime] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioCashMovement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioCashMovement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortfolioCashMovement_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[PortfolioAuditEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [portfolioId] NVARCHAR(1000) NOT NULL,
    [portfolioStrategyId] NVARCHAR(1000),
    [rebalanceRunId] NVARCHAR(1000),
    [portfolioOrderId] NVARCHAR(1000),
    [eventType] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL CONSTRAINT [PortfolioAuditEvent_severity_df] DEFAULT 'INFO',
    [payloadJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortfolioAuditEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PortfolioAuditEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyPortfolio_status_createdAt_idx] ON [dbo].[StrategyPortfolio]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioStrategy_portfolioId_status_priority_idx] ON [dbo].[PortfolioStrategy]([portfolioId], [status], [priority]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioStrategy_strategyDeploymentId_idx] ON [dbo].[PortfolioStrategy]([strategyDeploymentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioAllocationRule_portfolioId_effectiveFrom_idx] ON [dbo].[PortfolioAllocationRule]([portfolioId], [effectiveFrom]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioRiskRule_portfolioId_createdAt_idx] ON [dbo].[PortfolioRiskRule]([portfolioId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioEquitySnapshot_portfolioId_snapshotDate_idx] ON [dbo].[PortfolioEquitySnapshot]([portfolioId], [snapshotDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioRebalanceRun_portfolioId_createdAt_idx] ON [dbo].[PortfolioRebalanceRun]([portfolioId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioRebalanceRun_status_tradeDate_idx] ON [dbo].[PortfolioRebalanceRun]([status], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioPerformanceAttribution_portfolioId_attributionDate_idx] ON [dbo].[PortfolioPerformanceAttribution]([portfolioId], [attributionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioSignalIntent_portfolioId_tradeDate_symbol_idx] ON [dbo].[PortfolioSignalIntent]([portfolioId], [tradeDate], [symbol]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioSignalIntent_portfolioStrategyId_tradeDate_idx] ON [dbo].[PortfolioSignalIntent]([portfolioStrategyId], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioSignalIntent_strategySignalId_idx] ON [dbo].[PortfolioSignalIntent]([strategySignalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioPosition_portfolioId_assetType_theme_idx] ON [dbo].[PortfolioPosition]([portfolioId], [assetType], [theme]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioStrategyPosition_portfolioStrategyId_idx] ON [dbo].[PortfolioStrategyPosition]([portfolioStrategyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioOrder_portfolioId_status_idx] ON [dbo].[PortfolioOrder]([portfolioId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioOrder_rebalanceRunId_symbol_idx] ON [dbo].[PortfolioOrder]([rebalanceRunId], [symbol]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioOrderAllocation_portfolioStrategyId_idx] ON [dbo].[PortfolioOrderAllocation]([portfolioStrategyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioFill_executionTime_idx] ON [dbo].[PortfolioFill]([executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioFillAllocation_portfolioStrategyId_createdAt_idx] ON [dbo].[PortfolioFillAllocation]([portfolioStrategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioCashMovement_portfolioId_eventTime_idx] ON [dbo].[PortfolioCashMovement]([portfolioId], [eventTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioCashMovement_portfolioStrategyId_eventTime_idx] ON [dbo].[PortfolioCashMovement]([portfolioStrategyId], [eventTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioAuditEvent_portfolioId_createdAt_idx] ON [dbo].[PortfolioAuditEvent]([portfolioId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortfolioAuditEvent_eventType_severity_idx] ON [dbo].[PortfolioAuditEvent]([eventType], [severity]);

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioStrategy] ADD CONSTRAINT [PortfolioStrategy_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioStrategy] ADD CONSTRAINT [PortfolioStrategy_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioStrategy] ADD CONSTRAINT [PortfolioStrategy_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioAllocationRule] ADD CONSTRAINT [PortfolioAllocationRule_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioRiskRule] ADD CONSTRAINT [PortfolioRiskRule_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioEquitySnapshot] ADD CONSTRAINT [PortfolioEquitySnapshot_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioRebalanceRun] ADD CONSTRAINT [PortfolioRebalanceRun_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioPerformanceAttribution] ADD CONSTRAINT [PortfolioPerformanceAttribution_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioPerformanceAttribution] ADD CONSTRAINT [PortfolioPerformanceAttribution_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioSignalIntent] ADD CONSTRAINT [PortfolioSignalIntent_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioSignalIntent] ADD CONSTRAINT [PortfolioSignalIntent_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioSignalIntent] ADD CONSTRAINT [PortfolioSignalIntent_rebalanceRunId_fkey] FOREIGN KEY ([rebalanceRunId]) REFERENCES [dbo].[PortfolioRebalanceRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioSignalIntent] ADD CONSTRAINT [PortfolioSignalIntent_strategySignalId_fkey] FOREIGN KEY ([strategySignalId]) REFERENCES [dbo].[StrategySignal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioPosition] ADD CONSTRAINT [PortfolioPosition_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioStrategyPosition] ADD CONSTRAINT [PortfolioStrategyPosition_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioOrder] ADD CONSTRAINT [PortfolioOrder_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioOrder] ADD CONSTRAINT [PortfolioOrder_rebalanceRunId_fkey] FOREIGN KEY ([rebalanceRunId]) REFERENCES [dbo].[PortfolioRebalanceRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioOrderAllocation] ADD CONSTRAINT [PortfolioOrderAllocation_portfolioOrderId_fkey] FOREIGN KEY ([portfolioOrderId]) REFERENCES [dbo].[PortfolioOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioOrderAllocation] ADD CONSTRAINT [PortfolioOrderAllocation_portfolioSignalIntentId_fkey] FOREIGN KEY ([portfolioSignalIntentId]) REFERENCES [dbo].[PortfolioSignalIntent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioOrderAllocation] ADD CONSTRAINT [PortfolioOrderAllocation_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioFill] ADD CONSTRAINT [PortfolioFill_portfolioOrderId_fkey] FOREIGN KEY ([portfolioOrderId]) REFERENCES [dbo].[PortfolioOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioFillAllocation] ADD CONSTRAINT [PortfolioFillAllocation_portfolioFillId_fkey] FOREIGN KEY ([portfolioFillId]) REFERENCES [dbo].[PortfolioFill]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioFillAllocation] ADD CONSTRAINT [PortfolioFillAllocation_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioFillAllocation] ADD CONSTRAINT [PortfolioFillAllocation_portfolioSignalIntentId_fkey] FOREIGN KEY ([portfolioSignalIntentId]) REFERENCES [dbo].[PortfolioSignalIntent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioCashMovement] ADD CONSTRAINT [PortfolioCashMovement_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioCashMovement] ADD CONSTRAINT [PortfolioCashMovement_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioCashMovement] ADD CONSTRAINT [PortfolioCashMovement_portfolioOrderId_fkey] FOREIGN KEY ([portfolioOrderId]) REFERENCES [dbo].[PortfolioOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioAuditEvent] ADD CONSTRAINT [PortfolioAuditEvent_portfolioId_fkey] FOREIGN KEY ([portfolioId]) REFERENCES [dbo].[StrategyPortfolio]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioAuditEvent] ADD CONSTRAINT [PortfolioAuditEvent_portfolioStrategyId_fkey] FOREIGN KEY ([portfolioStrategyId]) REFERENCES [dbo].[PortfolioStrategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioAuditEvent] ADD CONSTRAINT [PortfolioAuditEvent_rebalanceRunId_fkey] FOREIGN KEY ([rebalanceRunId]) REFERENCES [dbo].[PortfolioRebalanceRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PortfolioAuditEvent] ADD CONSTRAINT [PortfolioAuditEvent_portfolioOrderId_fkey] FOREIGN KEY ([portfolioOrderId]) REFERENCES [dbo].[PortfolioOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
