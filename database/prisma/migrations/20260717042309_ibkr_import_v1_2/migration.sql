BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Account] ADD [brokerAccountId] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[AccountEquitySnapshot] ADD [importBatchId] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[Trade] ADD [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [Trade_currency_df] DEFAULT 'USD',
[externalId] NVARCHAR(1000),
[importBatchId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[ImportBatch] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [ImportBatch_source_df] DEFAULT 'IBKR_ACTIVITY_CSV',
    [fileName] NVARCHAR(1000) NOT NULL,
    [fileHash] VARCHAR(64) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ImportBatch_status_df] DEFAULT 'PREVIEW',
    [statementAccountId] NVARCHAR(1000),
    [statementStart] DATETIME2,
    [statementEnd] DATETIME2,
    [totalRecords] INT NOT NULL CONSTRAINT [ImportBatch_totalRecords_df] DEFAULT 0,
    [validRecords] INT NOT NULL CONSTRAINT [ImportBatch_validRecords_df] DEFAULT 0,
    [pendingRecords] INT NOT NULL CONSTRAINT [ImportBatch_pendingRecords_df] DEFAULT 0,
    [duplicateRecords] INT NOT NULL CONSTRAINT [ImportBatch_duplicateRecords_df] DEFAULT 0,
    [importedRecords] INT NOT NULL CONSTRAINT [ImportBatch_importedRecords_df] DEFAULT 0,
    [failedRecords] INT NOT NULL CONSTRAINT [ImportBatch_failedRecords_df] DEFAULT 0,
    [resultJson] NVARCHAR(max),
    [rollbackData] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [confirmedAt] DATETIME2,
    [rolledBackAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportBatch_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ImportBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ImportRecord] (
    [id] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [sourceSection] NVARCHAR(1000) NOT NULL,
    [sourceRow] INT NOT NULL,
    [recordType] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ImportRecord_status_df] DEFAULT 'VALID',
    [externalId] VARCHAR(128) NOT NULL,
    [dedupKey] VARCHAR(200) NOT NULL,
    [externalAccountId] NVARCHAR(1000),
    [transactionDate] DATETIME2,
    [symbol] NVARCHAR(1000),
    [currency] NVARCHAR(1000),
    [action] NVARCHAR(1000),
    [quantity] DECIMAL(18,6),
    [price] DECIMAL(18,6),
    [amount] DECIMAL(18,4),
    [commission] DECIMAL(18,4),
    [realizedPnl] DECIMAL(18,4),
    [rawData] NVARCHAR(max) NOT NULL,
    [normalizedData] NVARCHAR(max) NOT NULL,
    [validationErrors] NVARCHAR(max),
    [resolutionNote] NVARCHAR(max),
    [relatedEntityType] NVARCHAR(1000),
    [relatedEntityId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ImportRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ImportRecord_dedupKey_key] UNIQUE NONCLUSTERED ([dedupKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportBatch_accountId_createdAt_idx] ON [dbo].[ImportBatch]([accountId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportBatch_fileHash_idx] ON [dbo].[ImportBatch]([fileHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportBatch_status_idx] ON [dbo].[ImportBatch]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportRecord_batchId_status_idx] ON [dbo].[ImportRecord]([batchId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportRecord_accountId_externalId_idx] ON [dbo].[ImportRecord]([accountId], [externalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportRecord_recordType_idx] ON [dbo].[ImportRecord]([recordType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_broker_brokerAccountId_idx] ON [dbo].[Account]([broker], [brokerAccountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountEquitySnapshot_importBatchId_idx] ON [dbo].[AccountEquitySnapshot]([importBatchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trade_externalId_idx] ON [dbo].[Trade]([externalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trade_importBatchId_idx] ON [dbo].[Trade]([importBatchId]);

-- AddForeignKey
ALTER TABLE [dbo].[AccountEquitySnapshot] ADD CONSTRAINT [AccountEquitySnapshot_importBatchId_fkey] FOREIGN KEY ([importBatchId]) REFERENCES [dbo].[ImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Trade] ADD CONSTRAINT [Trade_importBatchId_fkey] FOREIGN KEY ([importBatchId]) REFERENCES [dbo].[ImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportBatch] ADD CONSTRAINT [ImportBatch_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ImportRecord] ADD CONSTRAINT [ImportRecord_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[ImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportRecord] ADD CONSTRAINT [ImportRecord_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
