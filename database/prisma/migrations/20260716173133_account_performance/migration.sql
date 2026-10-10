BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Account] ADD [initialCapital] DECIMAL(18,4) NOT NULL CONSTRAINT [Account_initialCapital_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[AccountEquitySnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [snapshotDate] DATETIME2 NOT NULL,
    [totalEquity] DECIMAL(18,4) NOT NULL,
    [cashBalance] DECIMAL(18,4) NOT NULL,
    [realizedPnlYtd] DECIMAL(18,4) NOT NULL,
    [note] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountEquitySnapshot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AccountEquitySnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountEquitySnapshot_accountId_snapshotDate_key] UNIQUE NONCLUSTERED ([accountId],[snapshotDate])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountEquitySnapshot_accountId_snapshotDate_idx] ON [dbo].[AccountEquitySnapshot]([accountId], [snapshotDate]);

-- AddForeignKey
ALTER TABLE [dbo].[AccountEquitySnapshot] ADD CONSTRAINT [AccountEquitySnapshot_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
