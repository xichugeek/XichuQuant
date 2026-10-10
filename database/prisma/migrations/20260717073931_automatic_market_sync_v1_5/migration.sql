BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[MarketDataProvider] ADD [lastHealthAt] DATETIME2,
[lastHealthMessage] NVARCHAR(max),
[lastHealthStatus] NVARCHAR(1000),
[providerVersion] NVARCHAR(1000) CONSTRAINT [MarketDataProvider_providerVersion_df] DEFAULT '1.0',
[rateLimitJson] NVARCHAR(max);

-- AlterTable
ALTER TABLE [dbo].[StrategyDeployment] ADD [observationRequiredDays] INT NOT NULL CONSTRAINT [StrategyDeployment_observationRequiredDays_df] DEFAULT 20,
[observationStartedAt] DATETIME2;

-- CreateTable
CREATE TABLE [dbo].[TradingCalendarDay] (
    [id] NVARCHAR(1000) NOT NULL,
    [market] NVARCHAR(1000) NOT NULL CONSTRAINT [TradingCalendarDay_market_df] DEFAULT 'US',
    [tradeDate] DATE NOT NULL,
    [isTradingDay] BIT NOT NULL,
    [sessionOpenUtc] DATETIME2,
    [sessionCloseUtc] DATETIME2,
    [holidayName] NVARCHAR(1000),
    [timeZone] NVARCHAR(1000) NOT NULL CONSTRAINT [TradingCalendarDay_timeZone_df] DEFAULT 'America/New_York',
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [TradingCalendarDay_source_df] DEFAULT 'SYSTEM_NYSE_RULES',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TradingCalendarDay_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TradingCalendarDay_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TradingCalendarDay_market_tradeDate_key] UNIQUE NONCLUSTERED ([market],[tradeDate])
);

-- CreateTable
CREATE TABLE [dbo].[DataQualityReport] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [analysisDate] DATE NOT NULL,
    [latestTradeDate] DATE,
    [missingDayCount] INT NOT NULL CONSTRAINT [DataQualityReport_missingDayCount_df] DEFAULT 0,
    [duplicateCount] INT NOT NULL CONSTRAINT [DataQualityReport_duplicateCount_df] DEFAULT 0,
    [invalidOhlcCount] INT NOT NULL CONSTRAINT [DataQualityReport_invalidOhlcCount_df] DEFAULT 0,
    [zeroVolumeCount] INT NOT NULL CONSTRAINT [DataQualityReport_zeroVolumeCount_df] DEFAULT 0,
    [splitEventCount] INT NOT NULL CONSTRAINT [DataQualityReport_splitEventCount_df] DEFAULT 0,
    [dividendEventCount] INT NOT NULL CONSTRAINT [DataQualityReport_dividendEventCount_df] DEFAULT 0,
    [allowStrategyRun] BIT NOT NULL CONSTRAINT [DataQualityReport_allowStrategyRun_df] DEFAULT 0,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [DataQualityReport_status_df] DEFAULT 'PENDING',
    [issuesJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataQualityReport_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [DataQualityReport_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataQualityReport_providerId_symbol_analysisDate_key] UNIQUE NONCLUSTERED ([providerId],[symbol],[analysisDate])
);

-- CreateTable
CREATE TABLE [dbo].[SystemTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [parentTaskId] NVARCHAR(1000),
    [taskType] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] VARCHAR(240) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [SystemTask_status_df] DEFAULT 'PENDING',
    [marketDate] DATE,
    [scheduledFor] DATETIME2,
    [attemptCount] INT NOT NULL CONSTRAINT [SystemTask_attemptCount_df] DEFAULT 0,
    [maxAttempts] INT NOT NULL CONSTRAINT [SystemTask_maxAttempts_df] DEFAULT 3,
    [inputJson] NVARCHAR(max),
    [resultJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SystemTask_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SystemTask_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SystemTask_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[SystemNotification] (
    [id] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [severity] NVARCHAR(1000) NOT NULL CONSTRAINT [SystemNotification_severity_df] DEFAULT 'INFO',
    [title] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [SystemNotification_status_df] DEFAULT 'UNREAD',
    [sourceTaskId] NVARCHAR(1000),
    [metadataJson] NVARCHAR(max),
    [dedupeKey] VARCHAR(240),
    [readAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SystemNotification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SystemNotification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SystemNotification_dedupeKey_key] UNIQUE NONCLUSTERED ([dedupeKey])
);

-- CreateTable
CREATE TABLE [dbo].[ForwardObservationSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyDeploymentId] NVARCHAR(1000) NOT NULL,
    [observationDate] DATE NOT NULL,
    [runningTradingDays] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_runningTradingDays_df] DEFAULT 0,
    [signalCount] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_signalCount_df] DEFAULT 0,
    [fillCount] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_fillCount_df] DEFAULT 0,
    [actualReturn] DECIMAL(18,8) NOT NULL CONSTRAINT [ForwardObservationSnapshot_actualReturn_df] DEFAULT 0,
    [theoreticalReturn] DECIMAL(18,8) NOT NULL CONSTRAINT [ForwardObservationSnapshot_theoreticalReturn_df] DEFAULT 0,
    [returnDeviation] DECIMAL(18,8) NOT NULL CONSTRAINT [ForwardObservationSnapshot_returnDeviation_df] DEFAULT 0,
    [actualSlippage] DECIMAL(20,4) NOT NULL CONSTRAINT [ForwardObservationSnapshot_actualSlippage_df] DEFAULT 0,
    [totalCommission] DECIMAL(20,4) NOT NULL CONSTRAINT [ForwardObservationSnapshot_totalCommission_df] DEFAULT 0,
    [maxDrawdown] DECIMAL(18,8) NOT NULL CONSTRAINT [ForwardObservationSnapshot_maxDrawdown_df] DEFAULT 0,
    [consecutiveLosses] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_consecutiveLosses_df] DEFAULT 0,
    [riskRejectedCount] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_riskRejectedCount_df] DEFAULT 0,
    [dataSkippedCount] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_dataSkippedCount_df] DEFAULT 0,
    [serviceSkippedCount] INT NOT NULL CONSTRAINT [ForwardObservationSnapshot_serviceSkippedCount_df] DEFAULT 0,
    [comparisonJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ForwardObservationSnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ForwardObservationSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ForwardObservationSnapshot_strategyDeploymentId_observationDate_key] UNIQUE NONCLUSTERED ([strategyDeploymentId],[observationDate])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TradingCalendarDay_market_isTradingDay_tradeDate_idx] ON [dbo].[TradingCalendarDay]([market], [isTradingDay], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataQualityReport_symbol_analysisDate_idx] ON [dbo].[DataQualityReport]([symbol], [analysisDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataQualityReport_allowStrategyRun_status_idx] ON [dbo].[DataQualityReport]([allowStrategyRun], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SystemTask_taskType_status_createdAt_idx] ON [dbo].[SystemTask]([taskType], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SystemTask_marketDate_taskType_idx] ON [dbo].[SystemTask]([marketDate], [taskType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SystemTask_parentTaskId_idx] ON [dbo].[SystemTask]([parentTaskId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SystemNotification_status_severity_createdAt_idx] ON [dbo].[SystemNotification]([status], [severity], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SystemNotification_type_createdAt_idx] ON [dbo].[SystemNotification]([type], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ForwardObservationSnapshot_strategyDeploymentId_observationDate_idx] ON [dbo].[ForwardObservationSnapshot]([strategyDeploymentId], [observationDate]);

-- AddForeignKey
ALTER TABLE [dbo].[DataQualityReport] ADD CONSTRAINT [DataQualityReport_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[MarketDataProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ForwardObservationSnapshot] ADD CONSTRAINT [ForwardObservationSnapshot_strategyDeploymentId_fkey] FOREIGN KEY ([strategyDeploymentId]) REFERENCES [dbo].[StrategyDeployment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
