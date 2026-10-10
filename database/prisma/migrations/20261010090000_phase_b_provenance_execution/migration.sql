BEGIN TRY
BEGIN TRAN;
ALTER TABLE [dbo].[Account] ADD [dataOrigin] NVARCHAR(32) NOT NULL CONSTRAINT [Account_dataOrigin_df] DEFAULT 'UNKNOWN';
ALTER TABLE [dbo].[PaperAccount] ADD [dataOrigin] NVARCHAR(32) NOT NULL CONSTRAINT [PaperAccount_dataOrigin_df] DEFAULT 'INTERNAL_PAPER';
ALTER TABLE [dbo].[BrokerAccount] ADD [dataOrigin] NVARCHAR(32) NOT NULL CONSTRAINT [BrokerAccount_dataOrigin_df] DEFAULT 'UNKNOWN';
ALTER TABLE [dbo].[MarketDataDaily] ADD [dataOrigin] NVARCHAR(32) NOT NULL CONSTRAINT [MarketDataDaily_dataOrigin_df] DEFAULT 'HISTORICAL';
ALTER TABLE [dbo].[BrokerPaperOrder] ADD [protectiveStopQuantity] DECIMAL(18,6);
ALTER TABLE [dbo].[BrokerPaperExecution] ADD [executionRole] NVARCHAR(32) NOT NULL CONSTRAINT [BrokerPaperExecution_executionRole_df] DEFAULT 'UNKNOWN', [externalOrderId] NVARCHAR(1000), [externalPermanentId] NVARCHAR(1000);
-- Existing synthetic rows remain synthetic. No account balance or history is rewritten.
EXEC(N'UPDATE [dbo].[MarketDataDaily] SET [dataOrigin] = ''SYNTHETIC'' WHERE [source] = ''SEED_V1_3'';');
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
