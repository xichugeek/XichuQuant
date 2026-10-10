BEGIN TRY
BEGIN TRAN;
ALTER TABLE [dbo].[BrokerExecution] ALTER COLUMN [commission] DECIMAL(18,4) NULL;
ALTER TABLE [dbo].[BrokerExecution] ADD [commissionKnown] BIT NOT NULL CONSTRAINT [BrokerExecution_commissionKnown_df] DEFAULT 0;
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
