BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Strategy] ADD [approvalStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Strategy_approvalStatus_df] DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE [dbo].[StrategySignal] ADD [paperAccountId] NVARCHAR(1000),
[signalContext] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategySignal_signalContext_df] DEFAULT 'REAL_ACCOUNT';

-- CreateTable
CREATE TABLE [dbo].[StrategyValidationRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyValidationRun_status_df] DEFAULT 'PENDING',
    [symbolsJson] NVARCHAR(max) NOT NULL,
    [marketDataSource] NVARCHAR(1000) NOT NULL,
    [marketDataStart] DATE NOT NULL,
    [marketDataEnd] DATE NOT NULL,
    [inSampleRatio] DECIMAL(8,6) NOT NULL CONSTRAINT [StrategyValidationRun_inSampleRatio_df] DEFAULT 0.7,
    [walkForwardConfigJson] NVARCHAR(max) NOT NULL,
    [parameterGridJson] NVARCHAR(max) NOT NULL,
    [stressConfigJson] NVARCHAR(max) NOT NULL,
    [parameterSnapshot] NVARCHAR(max) NOT NULL,
    [randomSeed] INT NOT NULL CONSTRAINT [StrategyValidationRun_randomSeed_df] DEFAULT 42,
    [codeVersion] NVARCHAR(1000) NOT NULL,
    [quantEngineVersion] NVARCHAR(1000),
    [inSampleMetricsJson] NVARCHAR(max),
    [outSampleMetricsJson] NVARCHAR(max),
    [regimeMetricsJson] NVARCHAR(max),
    [crossSymbolMetricsJson] NVARCHAR(max),
    [warningsJson] NVARCHAR(max),
    [robustnessScore] DECIMAL(18,8),
    [recommendation] NVARCHAR(1000),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyValidationRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategyValidationRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ValidationWindow] (
    [id] NVARCHAR(1000) NOT NULL,
    [validationRunId] NVARCHAR(1000) NOT NULL,
    [sequence] INT NOT NULL,
    [windowType] NVARCHAR(1000) NOT NULL,
    [trainStart] DATE NOT NULL,
    [trainEnd] DATE NOT NULL,
    [testStart] DATE NOT NULL,
    [testEnd] DATE NOT NULL,
    [parameterSnapshot] NVARCHAR(max) NOT NULL,
    [trainMetricsJson] NVARCHAR(max),
    [testMetricsJson] NVARCHAR(max) NOT NULL,
    [testEquityJson] NVARCHAR(max),
    [testTradesJson] NVARCHAR(max),
    [totalReturn] DECIMAL(18,8),
    [maxDrawdown] DECIMAL(18,8),
    [sharpeRatio] DECIMAL(18,8),
    [profitFactor] DECIMAL(18,8),
    [tradeCount] INT NOT NULL CONSTRAINT [ValidationWindow_tradeCount_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ValidationWindow_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ValidationWindow_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ValidationWindow_validationRunId_sequence_windowType_key] UNIQUE NONCLUSTERED ([validationRunId],[sequence],[windowType])
);

-- CreateTable
CREATE TABLE [dbo].[ParameterSweepRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [validationRunId] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ParameterSweepRun_status_df] DEFAULT 'PENDING',
    [dimensionsJson] NVARCHAR(max) NOT NULL,
    [objectiveMetric] NVARCHAR(1000) NOT NULL CONSTRAINT [ParameterSweepRun_objectiveMetric_df] DEFAULT 'ROBUSTNESS',
    [stabilitySummaryJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ParameterSweepRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ParameterSweepRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ParameterSweepResult] (
    [id] NVARCHAR(1000) NOT NULL,
    [sweepRunId] NVARCHAR(1000) NOT NULL,
    [parameterKey] VARCHAR(200) NOT NULL,
    [parametersJson] NVARCHAR(max) NOT NULL,
    [totalReturn] DECIMAL(18,8) NOT NULL,
    [maxDrawdown] DECIMAL(18,8) NOT NULL,
    [sharpeRatio] DECIMAL(18,8),
    [profitFactor] DECIMAL(18,8),
    [tradeCount] INT NOT NULL,
    [stabilityScore] DECIMAL(18,8),
    [flagsJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ParameterSweepResult_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ParameterSweepResult_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ParameterSweepResult_sweepRunId_parameterKey_key] UNIQUE NONCLUSTERED ([sweepRunId],[parameterKey])
);

-- CreateTable
CREATE TABLE [dbo].[StressTestRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [validationRunId] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StressTestRun_status_df] DEFAULT 'PENDING',
    [baselineMetricsJson] NVARCHAR(max),
    [summaryJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StressTestRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StressTestRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[StressTestResult] (
    [id] NVARCHAR(1000) NOT NULL,
    [stressTestRunId] NVARCHAR(1000) NOT NULL,
    [scenarioCode] NVARCHAR(1000) NOT NULL,
    [scenarioConfigJson] NVARCHAR(max) NOT NULL,
    [metricsJson] NVARCHAR(max) NOT NULL,
    [totalReturn] DECIMAL(18,8) NOT NULL,
    [maxDrawdown] DECIMAL(18,8) NOT NULL,
    [returnDegradation] DECIMAL(18,8) NOT NULL,
    [tradeCount] INT NOT NULL,
    [failed] BIT NOT NULL CONSTRAINT [StressTestResult_failed_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StressTestResult_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [StressTestResult_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StressTestResult_stressTestRunId_scenarioCode_key] UNIQUE NONCLUSTERED ([stressTestRunId],[scenarioCode])
);

-- CreateTable
CREATE TABLE [dbo].[StrategyApproval] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [validationRunId] NVARCHAR(1000) NOT NULL,
    [decisionVersion] INT NOT NULL CONSTRAINT [StrategyApproval_decisionVersion_df] DEFAULT 1,
    [status] NVARCHAR(1000) NOT NULL,
    [userConfirmed] BIT NOT NULL CONSTRAINT [StrategyApproval_userConfirmed_df] DEFAULT 0,
    [criteriaJson] NVARCHAR(max) NOT NULL,
    [reasonsJson] NVARCHAR(max) NOT NULL,
    [riskResultJson] NVARCHAR(max),
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [StrategyApproval_requestedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [decidedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyApproval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [StrategyApproval_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StrategyApproval_validationRunId_decisionVersion_key] UNIQUE NONCLUSTERED ([validationRunId],[decisionVersion])
);

-- CreateTable
CREATE TABLE [dbo].[PaperAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [baseCurrency] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperAccount_baseCurrency_df] DEFAULT 'USD',
    [initialCapital] DECIMAL(20,4) NOT NULL,
    [cashBalance] DECIMAL(20,4) NOT NULL,
    [totalEquity] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PaperAccount_realizedPnl_df] DEFAULT 0,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PaperAccount_unrealizedPnl_df] DEFAULT 0,
    [peakEquity] DECIMAL(20,4) NOT NULL,
    [maxDrawdown] DECIMAL(18,8) NOT NULL CONSTRAINT [PaperAccount_maxDrawdown_df] DEFAULT 0,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperAccount_status_df] DEFAULT 'ACTIVE',
    [killSwitchEnabled] BIT NOT NULL CONSTRAINT [PaperAccount_killSwitchEnabled_df] DEFAULT 0,
    [killSwitchReason] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaperAccount_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PaperAccountEquitySnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [snapshotTime] DATETIME2 NOT NULL,
    [totalEquity] DECIMAL(20,4) NOT NULL,
    [cashBalance] DECIMAL(20,4) NOT NULL,
    [positionValue] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [drawdown] DECIMAL(18,8) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperAccountEquitySnapshot_source_df] DEFAULT 'PAPER_EXECUTION',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperAccountEquitySnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaperAccountEquitySnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaperAccountEquitySnapshot_paperAccountId_snapshotTime_key] UNIQUE NONCLUSTERED ([paperAccountId],[snapshotTime])
);

-- CreateTable
CREATE TABLE [dbo].[PaperPosition] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [avgCost] DECIMAL(20,6) NOT NULL,
    [currentPrice] DECIMAL(20,6) NOT NULL,
    [marketValue] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4) NOT NULL CONSTRAINT [PaperPosition_realizedPnl_df] DEFAULT 0,
    [openedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaperPosition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaperPosition_paperAccountId_strategyDeploymentId_symbol_key] UNIQUE NONCLUSTERED ([paperAccountId],[strategyDeploymentId],[symbol])
);

-- CreateTable
CREATE TABLE [dbo].[PaperOrder] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000) NOT NULL,
    [executionRunId] NVARCHAR(1000) NOT NULL,
    [strategySignalId] NVARCHAR(1000),
    [idempotencyKey] VARCHAR(200) NOT NULL,
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
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperOrder_status_df] DEFAULT 'CREATED',
    [rejectionReason] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [filledAt] DATETIME2,
    [cancelledAt] DATETIME2,
    CONSTRAINT [PaperOrder_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaperOrder_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[PaperFill] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperOrderId] NVARCHAR(1000) NOT NULL,
    [fillSequence] INT NOT NULL CONSTRAINT [PaperFill_fillSequence_df] DEFAULT 1,
    [executionTime] DATETIME2 NOT NULL,
    [price] DECIMAL(20,6) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [notional] DECIMAL(20,4) NOT NULL,
    [commission] DECIMAL(20,4) NOT NULL,
    [slippage] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperFill_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaperFill_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaperFill_paperOrderId_fillSequence_key] UNIQUE NONCLUSTERED ([paperOrderId],[fillSequence])
);

-- CreateTable
CREATE TABLE [dbo].[PaperCashMovement] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [paperOrderId] NVARCHAR(1000),
    [movementType] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(20,4) NOT NULL,
    [balanceAfter] DECIMAL(20,4) NOT NULL,
    [description] NVARCHAR(1000),
    [eventTime] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperCashMovement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaperCashMovement_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[StrategyDeployment] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [approvalId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyDeployment_status_df] DEFAULT 'PAPER_APPROVED',
    [symbolUniverseJson] NVARCHAR(max) NOT NULL,
    [parameterSnapshot] NVARCHAR(max) NOT NULL,
    [strategyVersion] INT NOT NULL,
    [codeVersion] NVARCHAR(1000) NOT NULL,
    [capitalAllocation] DECIMAL(20,4) NOT NULL,
    [maxPositionPercent] DECIMAL(8,4) NOT NULL,
    [stopLossCondition] NVARCHAR(1000) NOT NULL,
    [exitCondition] NVARCHAR(1000) NOT NULL,
    [paperRiskConfigJson] NVARCHAR(max) NOT NULL,
    [consecutiveLosses] INT NOT NULL CONSTRAINT [StrategyDeployment_consecutiveLosses_df] DEFAULT 0,
    [startedAt] DATETIME2,
    [pausedAt] DATETIME2,
    [stoppedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyDeployment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategyDeployment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[StrategyExecutionRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [signalTradeDate] DATE NOT NULL,
    [idempotencyKey] VARCHAR(200) NOT NULL,
    [strategyVersion] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategyExecutionRun_status_df] DEFAULT 'PENDING',
    [strategySignalId] NVARCHAR(1000),
    [inputSnapshotJson] NVARCHAR(max) NOT NULL,
    [resultJson] NVARCHAR(max),
    [quantEngineVersion] NVARCHAR(1000),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [StrategyExecutionRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyExecutionRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [StrategyExecutionRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StrategyExecutionRun_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey]),
    CONSTRAINT [StrategyExecutionRun_strategyDeploymentId_symbol_signalTradeDate_strategyVersion_key] UNIQUE NONCLUSTERED ([strategyDeploymentId],[symbol],[signalTradeDate],[strategyVersion])
);

-- CreateTable
CREATE TABLE [dbo].[PaperRiskDecision] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000) NOT NULL,
    [paperOrderId] NVARCHAR(1000),
    [strategySignalId] NVARCHAR(1000),
    [decision] NVARCHAR(1000) NOT NULL,
    [inputSnapshotJson] NVARCHAR(max) NOT NULL,
    [resultJson] NVARCHAR(max) NOT NULL,
    [violationsJson] NVARCHAR(max) NOT NULL,
    [engineVersion] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperRiskDecision_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaperRiskDecision_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PaperTradingEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [paperAccountId] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000),
    [paperOrderId] NVARCHAR(1000),
    [paperFillId] NVARCHAR(1000),
    [eventType] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperTradingEvent_severity_df] DEFAULT 'INFO',
    [payloadJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperTradingEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaperTradingEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PaperTradingControl] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [PaperTradingControl_id_df] DEFAULT 'global',
    [killSwitchEnabled] BIT NOT NULL CONSTRAINT [PaperTradingControl_killSwitchEnabled_df] DEFAULT 0,
    [reason] NVARCHAR(1000),
    [updatedBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaperTradingControl_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaperTradingControl_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyValidationRun_strategyId_createdAt_idx] ON [dbo].[StrategyValidationRun]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyValidationRun_status_idx] ON [dbo].[StrategyValidationRun]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ValidationWindow_validationRunId_testStart_idx] ON [dbo].[ValidationWindow]([validationRunId], [testStart]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ParameterSweepRun_validationRunId_status_idx] ON [dbo].[ParameterSweepRun]([validationRunId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ParameterSweepRun_strategyId_createdAt_idx] ON [dbo].[ParameterSweepRun]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ParameterSweepResult_sweepRunId_stabilityScore_idx] ON [dbo].[ParameterSweepResult]([sweepRunId], [stabilityScore]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StressTestRun_validationRunId_status_idx] ON [dbo].[StressTestRun]([validationRunId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StressTestRun_strategyId_createdAt_idx] ON [dbo].[StressTestRun]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StressTestResult_stressTestRunId_failed_idx] ON [dbo].[StressTestResult]([stressTestRunId], [failed]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyApproval_strategyId_status_idx] ON [dbo].[StrategyApproval]([strategyId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperAccount_status_idx] ON [dbo].[PaperAccount]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperAccountEquitySnapshot_paperAccountId_snapshotTime_idx] ON [dbo].[PaperAccountEquitySnapshot]([paperAccountId], [snapshotTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperPosition_paperAccountId_symbol_idx] ON [dbo].[PaperPosition]([paperAccountId], [symbol]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperPosition_strategyDeploymentId_idx] ON [dbo].[PaperPosition]([strategyDeploymentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperOrder_paperAccountId_status_idx] ON [dbo].[PaperOrder]([paperAccountId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperOrder_strategyDeploymentId_signalTradeDate_idx] ON [dbo].[PaperOrder]([strategyDeploymentId], [signalTradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperFill_executionTime_idx] ON [dbo].[PaperFill]([executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperCashMovement_paperAccountId_eventTime_idx] ON [dbo].[PaperCashMovement]([paperAccountId], [eventTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperCashMovement_paperOrderId_idx] ON [dbo].[PaperCashMovement]([paperOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyDeployment_paperAccountId_status_idx] ON [dbo].[StrategyDeployment]([paperAccountId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyDeployment_strategyId_createdAt_idx] ON [dbo].[StrategyDeployment]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyDeployment_approvalId_idx] ON [dbo].[StrategyDeployment]([approvalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategyExecutionRun_strategyDeploymentId_createdAt_idx] ON [dbo].[StrategyExecutionRun]([strategyDeploymentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperRiskDecision_strategyDeploymentId_createdAt_idx] ON [dbo].[PaperRiskDecision]([strategyDeploymentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperRiskDecision_paperOrderId_idx] ON [dbo].[PaperRiskDecision]([paperOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperTradingEvent_paperAccountId_createdAt_idx] ON [dbo].[PaperTradingEvent]([paperAccountId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperTradingEvent_strategyDeploymentId_createdAt_idx] ON [dbo].[PaperTradingEvent]([strategyDeploymentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaperTradingEvent_eventType_idx] ON [dbo].[PaperTradingEvent]([eventType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategySignal_paperAccountId_status_idx] ON [dbo].[StrategySignal]([paperAccountId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[StrategyValidationRun] ADD CONSTRAINT [StrategyValidationRun_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ValidationWindow] ADD CONSTRAINT [ValidationWindow_validationRunId_fkey] FOREIGN KEY ([validationRunId]) REFERENCES [dbo].[StrategyValidationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ParameterSweepRun] ADD CONSTRAINT [ParameterSweepRun_validationRunId_fkey] FOREIGN KEY ([validationRunId]) REFERENCES [dbo].[StrategyValidationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ParameterSweepRun] ADD CONSTRAINT [ParameterSweepRun_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ParameterSweepResult] ADD CONSTRAINT [ParameterSweepResult_sweepRunId_fkey] FOREIGN KEY ([sweepRunId]) REFERENCES [dbo].[ParameterSweepRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StressTestRun] ADD CONSTRAINT [StressTestRun_validationRunId_fkey] FOREIGN KEY ([validationRunId]) REFERENCES [dbo].[StrategyValidationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StressTestRun] ADD CONSTRAINT [StressTestRun_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StressTestResult] ADD CONSTRAINT [StressTestResult_stressTestRunId_fkey] FOREIGN KEY ([stressTestRunId]) REFERENCES [dbo].[StressTestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategyApproval] ADD CONSTRAINT [StrategyApproval_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategyApproval] ADD CONSTRAINT [StrategyApproval_validationRunId_fkey] FOREIGN KEY ([validationRunId]) REFERENCES [dbo].[StrategyValidationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperAccountEquitySnapshot] ADD CONSTRAINT [PaperAccountEquitySnapshot_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperPosition] ADD CONSTRAINT [PaperPosition_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperPosition] ADD CONSTRAINT [PaperPosition_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperOrder] ADD CONSTRAINT [PaperOrder_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperOrder] ADD CONSTRAINT [PaperOrder_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperOrder] ADD CONSTRAINT [PaperOrder_executionRunId_fkey] FOREIGN KEY ([executionRunId]) REFERENCES [dbo].[StrategyExecutionRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperFill] ADD CONSTRAINT [PaperFill_paperOrderId_fkey] FOREIGN KEY ([paperOrderId]) REFERENCES [dbo].[PaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperCashMovement] ADD CONSTRAINT [PaperCashMovement_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategyDeployment] ADD CONSTRAINT [StrategyDeployment_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategyDeployment] ADD CONSTRAINT [StrategyDeployment_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategyExecutionRun] ADD CONSTRAINT [StrategyExecutionRun_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperRiskDecision] ADD CONSTRAINT [PaperRiskDecision_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperRiskDecision] ADD CONSTRAINT [PaperRiskDecision_paperOrderId_fkey] FOREIGN KEY ([paperOrderId]) REFERENCES [dbo].[PaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperTradingEvent] ADD CONSTRAINT [PaperTradingEvent_paperAccountId_fkey] FOREIGN KEY ([paperAccountId]) REFERENCES [dbo].[PaperAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperTradingEvent] ADD CONSTRAINT [PaperTradingEvent_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperTradingEvent] ADD CONSTRAINT [PaperTradingEvent_paperOrderId_fkey] FOREIGN KEY ([paperOrderId]) REFERENCES [dbo].[PaperOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaperTradingEvent] ADD CONSTRAINT [PaperTradingEvent_paperFillId_fkey] FOREIGN KEY ([paperFillId]) REFERENCES [dbo].[PaperFill]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
