CREATE TABLE [StrategyEvidenceProvider] (
    [id] VARCHAR(64) NOT NULL CONSTRAINT [StrategyEvidenceProvider_id_df] DEFAULT NEWID(),
    [code] VARCHAR(64) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [evidenceType] VARCHAR(40) NOT NULL,
    [providerType] VARCHAR(64) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [StrategyEvidenceProvider_enabled_df] DEFAULT 1,
    [configJson] NVARCHAR(MAX),
    [apiKeyEnv] VARCHAR(80),
    [lastHealthStatus] VARCHAR(40),
    [lastHealthMessage] NVARCHAR(MAX),
    [lastHealthAt] DATETIME2,
    [lastSyncAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyEvidenceProvider_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategyEvidenceProvider_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [StrategyEvidenceObservation] (
    [id] VARCHAR(100) NOT NULL CONSTRAINT [StrategyEvidenceObservation_id_df] DEFAULT NEWID(),
    [providerId] VARCHAR(64) NOT NULL,
    [symbol] VARCHAR(32) NOT NULL,
    [evidenceType] VARCHAR(40) NOT NULL,
    [metricCode] VARCHAR(64) NOT NULL,
    [observedAt] DATETIME2 NOT NULL,
    [availableAt] DATETIME2 NOT NULL,
    [expiresAt] DATETIME2,
    [value] DECIMAL(24,8) NOT NULL,
    [unit] VARCHAR(32),
    [verificationStatus] VARCHAR(32) NOT NULL CONSTRAINT [StrategyEvidenceObservation_verificationStatus_df] DEFAULT 'VERIFIED',
    [derivation] NVARCHAR(MAX),
    [sourceUrl] NVARCHAR(1000) NOT NULL,
    [rawDataJson] NVARCHAR(MAX),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StrategyEvidenceObservation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StrategyEvidenceObservation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StrategyEvidenceObservation_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [StrategyEvidenceProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX [StrategyEvidenceProvider_code_key] ON [StrategyEvidenceProvider]([code]);
CREATE INDEX [StrategyEvidenceProvider_evidenceType_enabled_idx] ON [StrategyEvidenceProvider]([evidenceType], [enabled]);
CREATE INDEX [StrategyEvidenceProvider_lastHealthStatus_lastHealthAt_idx] ON [StrategyEvidenceProvider]([lastHealthStatus], [lastHealthAt]);

CREATE UNIQUE INDEX [StrategyEvidenceObservation_providerId_symbol_metricCode_observedAt_key] ON [StrategyEvidenceObservation]([providerId], [symbol], [metricCode], [observedAt]);
CREATE INDEX [StrategyEvidenceObservation_symbol_metricCode_availableAt_idx] ON [StrategyEvidenceObservation]([symbol], [metricCode], [availableAt]);
CREATE INDEX [StrategyEvidenceObservation_evidenceType_availableAt_idx] ON [StrategyEvidenceObservation]([evidenceType], [availableAt]);
CREATE INDEX [StrategyEvidenceObservation_verificationStatus_availableAt_idx] ON [StrategyEvidenceObservation]([verificationStatus], [availableAt]);
