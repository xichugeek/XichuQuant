BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [displayName] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_username_key] UNIQUE NONCLUSTERED ([username])
);

-- CreateTable
CREATE TABLE [dbo].[Account] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [broker] NVARCHAR(1000),
    [baseCurrency] NVARCHAR(1000) NOT NULL CONSTRAINT [Account_baseCurrency_df] DEFAULT 'USD',
    [totalEquity] DECIMAL(18,4) NOT NULL,
    [cashBalance] DECIMAL(18,4) NOT NULL,
    [realizedPnlYtd] DECIMAL(18,4) NOT NULL CONSTRAINT [Account_realizedPnlYtd_df] DEFAULT 0,
    [note] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Account_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Account_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Instrument] (
    [id] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000),
    [market] NVARCHAR(1000),
    [assetType] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000),
    [theme] NVARCHAR(1000),
    [leverageRatio] DECIMAL(8,2),
    [isActive] BIT NOT NULL CONSTRAINT [Instrument_isActive_df] DEFAULT 1,
    [note] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Instrument_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Instrument_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Instrument_symbol_key] UNIQUE NONCLUSTERED ([symbol])
);

-- CreateTable
CREATE TABLE [dbo].[Position] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [avgCost] DECIMAL(18,4) NOT NULL,
    [currentPrice] DECIMAL(18,4) NOT NULL,
    [note] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Position_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Position_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Position_accountId_instrumentId_key] UNIQUE NONCLUSTERED ([accountId],[instrumentId])
);

-- CreateTable
CREATE TABLE [dbo].[Trade] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [tradeDate] DATETIME2 NOT NULL,
    [side] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [price] DECIMAL(18,4) NOT NULL,
    [commission] DECIMAL(18,4) NOT NULL CONSTRAINT [Trade_commission_df] DEFAULT 0,
    [amount] DECIMAL(18,4) NOT NULL,
    [realizedPnl] DECIMAL(18,4),
    [reason] NVARCHAR(1000),
    [emotionTag] NVARCHAR(1000),
    [isRuleFollowed] BIT,
    [note] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Trade_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Trade_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TradePlan] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [planType] NVARCHAR(1000) NOT NULL,
    [plannedAmount] DECIMAL(18,4) NOT NULL,
    [plannedPrice] DECIMAL(18,4),
    [plannedQuantity] DECIMAL(18,6),
    [reason] NVARCHAR(1000) NOT NULL,
    [maxAcceptableLoss] DECIMAL(18,4),
    [stopLossCondition] NVARCHAR(1000),
    [takeProfitCondition] NVARCHAR(1000),
    [holdingPeriod] NVARCHAR(1000),
    [allowAddPosition] BIT NOT NULL CONSTRAINT [TradePlan_allowAddPosition_df] DEFAULT 0,
    [addPositionCondition] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [TradePlan_status_df] DEFAULT 'DRAFT',
    [reviewResult] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TradePlan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TradePlan_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RiskRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(1000) NOT NULL,
    [limitValue] DECIMAL(18,4) NOT NULL,
    [level] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [RiskRule_enabled_df] DEFAULT 1,
    [description] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RiskRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RiskRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RiskRule_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[RiskAlert] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [ruleCode] NVARCHAR(1000) NOT NULL,
    [level] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000),
    [currentValue] DECIMAL(18,4),
    [limitValue] DECIMAL(18,4),
    [suggestedAction] NVARCHAR(1000),
    [isResolved] BIT NOT NULL CONSTRAINT [RiskAlert_isResolved_df] DEFAULT 0,
    [resolvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RiskAlert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RiskAlert_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ReviewNote] (
    [id] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000),
    [relatedTradeId] NVARCHAR(1000),
    [mistakeType] NVARCHAR(1000),
    [summary] NVARCHAR(1000) NOT NULL,
    [lesson] NVARCHAR(1000) NOT NULL,
    [actionRule] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ReviewNote_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReviewNote_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PriceSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [price] DECIMAL(18,4) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [PriceSnapshot_source_df] DEFAULT 'MANUAL',
    [snapshotTime] DATETIME2 NOT NULL CONSTRAINT [PriceSnapshot_snapshotTime_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PriceSnapshot_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_userId_idx] ON [dbo].[Account]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Position_accountId_idx] ON [dbo].[Position]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Position_instrumentId_idx] ON [dbo].[Position]([instrumentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trade_accountId_idx] ON [dbo].[Trade]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trade_instrumentId_idx] ON [dbo].[Trade]([instrumentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trade_tradeDate_idx] ON [dbo].[Trade]([tradeDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TradePlan_accountId_idx] ON [dbo].[TradePlan]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TradePlan_symbol_idx] ON [dbo].[TradePlan]([symbol]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RiskAlert_accountId_isResolved_idx] ON [dbo].[RiskAlert]([accountId], [isResolved]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RiskAlert_ruleCode_idx] ON [dbo].[RiskAlert]([ruleCode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReviewNote_symbol_idx] ON [dbo].[ReviewNote]([symbol]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PriceSnapshot_instrumentId_snapshotTime_idx] ON [dbo].[PriceSnapshot]([instrumentId], [snapshotTime]);

-- AddForeignKey
ALTER TABLE [dbo].[Account] ADD CONSTRAINT [Account_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[Instrument]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Trade] ADD CONSTRAINT [Trade_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Trade] ADD CONSTRAINT [Trade_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[Instrument]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[TradePlan] ADD CONSTRAINT [TradePlan_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[RiskAlert] ADD CONSTRAINT [RiskAlert_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PriceSnapshot] ADD CONSTRAINT [PriceSnapshot_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[Instrument]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
