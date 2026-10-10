BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[BrokerPaperOrder] ADD
    [protectiveStopExternalOrderId] NVARCHAR(1000),
    [protectiveStopPermanentId] NVARCHAR(1000),
    [protectiveStopPrice] DECIMAL(18,6),
    [protectiveStopStatus] NVARCHAR(1000),
    [protectiveStopLatestStatusAt] DATETIME2;

CREATE NONCLUSTERED INDEX [BrokerPaperOrder_protectiveStopExternalOrderId_idx]
ON [dbo].[BrokerPaperOrder]([protectiveStopExternalOrderId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
