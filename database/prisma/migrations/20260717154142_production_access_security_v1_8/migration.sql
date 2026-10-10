BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UserSession] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [tokenHash] VARCHAR(64) NOT NULL,
    [csrfHash] VARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UserSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserSession_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[LoginAttempt] (
    [id] NVARCHAR(1000) NOT NULL,
    [normalizedUsername] VARCHAR(120) NOT NULL,
    [addressHash] VARCHAR(64) NOT NULL,
    [succeeded] BIT NOT NULL,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [LoginAttempt_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LoginAttempt_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserSession_userId_expiresAt_idx] ON [dbo].[UserSession]([userId], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserSession_expiresAt_revokedAt_idx] ON [dbo].[UserSession]([expiresAt], [revokedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoginAttempt_normalizedUsername_addressHash_occurredAt_idx] ON [dbo].[LoginAttempt]([normalizedUsername], [addressHash], [occurredAt]);

-- AddForeignKey
ALTER TABLE [dbo].[UserSession] ADD CONSTRAINT [UserSession_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
