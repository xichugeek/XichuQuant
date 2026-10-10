BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[BrokerPaperOrder] ADD
    [brokerReplyId] VARCHAR(160),
    [brokerReplyMessage] NVARCHAR(MAX),
    [brokerReplyReceivedAt] DATETIME2;

-- CreateIndex
CREATE NONCLUSTERED INDEX [BrokerPaperOrder_brokerReplyId_status_idx]
ON [dbo].[BrokerPaperOrder]([brokerReplyId], [status]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
