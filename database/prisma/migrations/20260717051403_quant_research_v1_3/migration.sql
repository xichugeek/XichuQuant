BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[MarketDataProvider] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [providerType] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [MarketDataProvider_enabled_df] DEFAULT 1,
    [configJson] NVARCHAR(max),
    [lastSyncAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketDataProvider_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketDataProvider_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MarketDataProvider_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[MarketDataDaily] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [tradeDate] DATE NOT NULL,
    [open] DECIMAL(20,6) NOT NULL,
    [high] DECIMAL(20,6) NOT NULL,
    [low] DECIMAL(20,6) NOT NULL,
    [close] DECIMAL(20,6) NOT NULL,
    [adjustedClose] DECIMAL(20,6) NOT NULL,
    [volume] DECIMAL(24,4) NOT NULL CONSTRAINT [MarketDataDaily_volume_df] DEFAULT 0,
    [dividend] DECIMAL(20,6) NOT NULL CONSTRAINT [MarketDataDaily_dividend_df] DEFAULT 0,
    [splitFactor] DECIMAL(18,8) NOT NULL CONSTRAINT [MarketDataDaily_splitFactor_df] DEFAULT 1,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [MarketDataDaily_currency_df] DEFAULT 'USD',
    [source] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketDataDaily_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketDataDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MarketDataDaily_symbol_tradeDate_source_key] UNIQUE NONCLUSTERED ([symbol],[tradeDate],[source])
);

-- CreateTable
CREATE TABLE [dbo].[MarketDataImportBatch] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(1000) NOT NULL,
    [fileHash] VARCHAR(64) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [MarketDataImportBatch_status_df] DEFAULT 'PREVIEW',
    [symbol] NVARCHAR(1000),
    [startDate] DATE,
    [endDate] DATE,
    [totalRecords] INT NOT NULL CONSTRAINT [MarketDataImportBatch_totalRecords_df] DEFAULT 0,
    [validRecords] INT NOT NULL CONSTRAINT [MarketDataImportBatch_validRecords_df] DEFAULT 0,
    [pendingRecords] INT NOT NULL CONSTRAINT [MarketDataImportBatch_pendingRecords_df] DEFAULT 0,
    [duplicateRecords] INT NOT NULL CONSTRAINT [MarketDataImportBatch_duplicateRecords_df] DEFAULT 0,
    [importedRecords] INT NOT NULL CONSTRAINT [MarketDataImportBatch_importedRecords_df] DEFAULT 0,
    [missingDaysJson] NVARCHAR(max),
    [mappingJson] NVARCHAR(max),
    [resultJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [confirmedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketDataImportBatch_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketDataImportBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MarketDataImportRecord] (
    [id] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [sourceRow] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [MarketDataImportRecord_status_df] DEFAULT 'VALID',
    [symbol] NVARCHAR(1000),
    [tradeDate] DATE,
    [normalizedData] NVARCHAR(max) NOT NULL,
    [rawData] NVARCHAR(max) NOT NULL,
    [validationErrors] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketDataImportRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketDataImportRecord_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MarketDataSyncJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000),
    [startDate] DATE,
    [endDate] DATE,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [MarketDataSyncJob_status_df] DEFAULT 'PENDING',
    [requestJson] NVARCHAR(max),
    [resultJson] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketDataSyncJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketDataSyncJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Strategy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [strategyType] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Strategy_version_df] DEFAULT 1,
    [symbolUniverse] NVARCHAR(max) NOT NULL,
    [timeframe] NVARCHAR(1000) NOT NULL CONSTRAINT [Strategy_timeframe_df] DEFAULT '1D',
    [parameters] NVARCHAR(max) NOT NULL,
    [parameterSchema] NVARCHAR(max),
    [initialCapital] DECIMAL(20,4) NOT NULL,
    [commissionRate] DECIMAL(12,8) NOT NULL CONSTRAINT [Strategy_commissionRate_df] DEFAULT 0.001,
    [slippageRate] DECIMAL(12,8) NOT NULL CONSTRAINT [Strategy_slippageRate_df] DEFAULT 0.0005,
    [positionSizingMode] NVARCHAR(1000) NOT NULL CONSTRAINT [Strategy_positionSizingMode_df] DEFAULT 'PERCENT_OF_EQUITY',
    [maxPositionPercent] DECIMAL(8,4) NOT NULL CONSTRAINT [Strategy_maxPositionPercent_df] DEFAULT 100,
    [enabled] BIT NOT NULL CONSTRAINT [Strategy_enabled_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Strategy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Strategy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Strategy_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[BacktestRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BacktestRun_status_df] DEFAULT 'PENDING',
    [symbol] NVARCHAR(1000) NOT NULL,
    [strategyVersion] INT NOT NULL,
    [parameterSnapshot] NVARCHAR(max) NOT NULL,
    [marketDataSource] NVARCHAR(1000) NOT NULL,
    [marketDataStart] DATE NOT NULL,
    [marketDataEnd] DATE NOT NULL,
    [initialCapital] DECIMAL(20,4) NOT NULL,
    [commissionRate] DECIMAL(12,8) NOT NULL,
    [slippageRate] DECIMAL(12,8) NOT NULL,
    [randomSeed] INT NOT NULL CONSTRAINT [BacktestRun_randomSeed_df] DEFAULT 42,
    [codeVersion] NVARCHAR(1000) NOT NULL,
    [quantEngineVersion] NVARCHAR(1000),
    [finalEquity] DECIMAL(20,4),
    [totalReturn] DECIMAL(18,8),
    [maxDrawdown] DECIMAL(18,8),
    [sharpeRatio] DECIMAL(18,8),
    [benchmarkReturn] DECIMAL(18,8),
    [totalCommission] DECIMAL(20,4),
    [tradeCount] INT,
    [metricsJson] NVARCHAR(max),
    [monthlyReturnsJson] NVARCHAR(max),
    [riskNotice] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [runDurationMs] INT,
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BacktestRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BacktestRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BacktestEquityPoint] (
    [id] NVARCHAR(1000) NOT NULL,
    [backtestRunId] NVARCHAR(1000) NOT NULL,
    [tradeDate] DATE NOT NULL,
    [equity] DECIMAL(20,4) NOT NULL,
    [cash] DECIMAL(20,4) NOT NULL,
    [positionValue] DECIMAL(20,4) NOT NULL,
    [drawdown] DECIMAL(18,8) NOT NULL,
    [benchmarkEquity] DECIMAL(20,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BacktestEquityPoint_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BacktestEquityPoint_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BacktestEquityPoint_backtestRunId_tradeDate_key] UNIQUE NONCLUSTERED ([backtestRunId],[tradeDate])
);

-- CreateTable
CREATE TABLE [dbo].[BacktestTrade] (
    [id] NVARCHAR(1000) NOT NULL,
    [backtestRunId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [signalTime] DATETIME2 NOT NULL,
    [orderTime] DATETIME2 NOT NULL,
    [executionTime] DATETIME2 NOT NULL,
    [executionPrice] DECIMAL(20,6) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [notional] DECIMAL(20,4) NOT NULL,
    [commission] DECIMAL(20,4) NOT NULL,
    [slippage] DECIMAL(20,4) NOT NULL,
    [realizedPnl] DECIMAL(20,4),
    [holdingDays] INT,
    [triggerReason] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BacktestTrade_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BacktestTrade_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BacktestPosition] (
    [id] NVARCHAR(1000) NOT NULL,
    [backtestRunId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(20,8) NOT NULL,
    [avgCost] DECIMAL(20,6) NOT NULL,
    [lastPrice] DECIMAL(20,6) NOT NULL,
    [marketValue] DECIMAL(20,4) NOT NULL,
    [unrealizedPnl] DECIMAL(20,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BacktestPosition_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BacktestPosition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BacktestPosition_backtestRunId_symbol_key] UNIQUE NONCLUSTERED ([backtestRunId],[symbol])
);

-- CreateTable
CREATE TABLE [dbo].[StrategySignal] (
    [id] NVARCHAR(1000) NOT NULL,
    [strategyId] NVARCHAR(1000) NOT NULL,
    [backtestRunId] NVARCHAR(1000),
    [accountId] NVARCHAR(1000),
    [symbol] NVARCHAR(1000) NOT NULL,
    [signalType] NVARCHAR(1000) NOT NULL,
    [signalTime] DATETIME2 NOT NULL,
    [requestedAmount] DECIMAL(20,4),
    [requestedQuantity] DECIMAL(20,8),
    [referencePrice] DECIMAL(20,6),
    [stopLossCondition] NVARCHAR(1000),
    [exitCondition] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [StrategySignal_status_df] DEFAULT 'GENERATED',
    [triggerReason] NVARCHAR(1000) NOT NULL,
    [riskResultJson] NVARCHAR(max),
    [rejectionReason] NVARCHAR(max),
    [reviewedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategySignal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategySignal_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataDaily_symbol_tradeDate_idx] ON [dbo].[MarketDataDaily]([symbol], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataDaily_providerId_tradeDate_idx] ON [dbo].[MarketDataDaily]([providerId], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataImportBatch_providerId_createdAt_idx] ON [dbo].[MarketDataImportBatch]([providerId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataImportBatch_fileHash_idx] ON [dbo].[MarketDataImportBatch]([fileHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataImportBatch_status_idx] ON [dbo].[MarketDataImportBatch]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataImportRecord_batchId_status_idx] ON [dbo].[MarketDataImportRecord]([batchId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataImportRecord_symbol_tradeDate_idx] ON [dbo].[MarketDataImportRecord]([symbol], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataSyncJob_providerId_createdAt_idx] ON [dbo].[MarketDataSyncJob]([providerId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MarketDataSyncJob_status_idx] ON [dbo].[MarketDataSyncJob]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Strategy_strategyType_enabled_idx] ON [dbo].[Strategy]([strategyType], [enabled]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestRun_strategyId_createdAt_idx] ON [dbo].[BacktestRun]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestRun_status_idx] ON [dbo].[BacktestRun]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestRun_symbol_marketDataStart_marketDataEnd_idx] ON [dbo].[BacktestRun]([symbol], [marketDataStart], [marketDataEnd]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestEquityPoint_backtestRunId_tradeDate_idx] ON [dbo].[BacktestEquityPoint]([backtestRunId], [tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestTrade_backtestRunId_executionTime_idx] ON [dbo].[BacktestTrade]([backtestRunId], [executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestTrade_symbol_executionTime_idx] ON [dbo].[BacktestTrade]([symbol], [executionTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BacktestPosition_backtestRunId_idx] ON [dbo].[BacktestPosition]([backtestRunId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategySignal_strategyId_createdAt_idx] ON [dbo].[StrategySignal]([strategyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategySignal_backtestRunId_signalTime_idx] ON [dbo].[StrategySignal]([backtestRunId], [signalTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategySignal_accountId_status_idx] ON [dbo].[StrategySignal]([accountId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StrategySignal_symbol_signalTime_idx] ON [dbo].[StrategySignal]([symbol], [signalTime]);

-- AddForeignKey
ALTER TABLE [dbo].[MarketDataDaily] ADD CONSTRAINT [MarketDataDaily_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[MarketDataProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MarketDataImportBatch] ADD CONSTRAINT [MarketDataImportBatch_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[MarketDataProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MarketDataImportRecord] ADD CONSTRAINT [MarketDataImportRecord_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[MarketDataImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MarketDataSyncJob] ADD CONSTRAINT [MarketDataSyncJob_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[MarketDataProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BacktestRun] ADD CONSTRAINT [BacktestRun_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BacktestEquityPoint] ADD CONSTRAINT [BacktestEquityPoint_backtestRunId_fkey] FOREIGN KEY ([backtestRunId]) REFERENCES [dbo].[BacktestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BacktestTrade] ADD CONSTRAINT [BacktestTrade_backtestRunId_fkey] FOREIGN KEY ([backtestRunId]) REFERENCES [dbo].[BacktestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BacktestPosition] ADD CONSTRAINT [BacktestPosition_backtestRunId_fkey] FOREIGN KEY ([backtestRunId]) REFERENCES [dbo].[BacktestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategySignal] ADD CONSTRAINT [StrategySignal_strategyId_fkey] FOREIGN KEY ([strategyId]) REFERENCES [dbo].[Strategy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategySignal] ADD CONSTRAINT [StrategySignal_backtestRunId_fkey] FOREIGN KEY ([backtestRunId]) REFERENCES [dbo].[BacktestRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StrategySignal] ADD CONSTRAINT [StrategySignal_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
