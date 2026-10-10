CREATE TABLE [MarketResearchSource] (
    [id] VARCHAR(64) NOT NULL CONSTRAINT [MarketResearchSource_id_df] DEFAULT NEWID(),
    [sourceType] VARCHAR(40) NOT NULL CONSTRAINT [MarketResearchSource_sourceType_df] DEFAULT 'YOUTUBE',
    [externalId] VARCHAR(64) NOT NULL,
    [creatorName] NVARCHAR(1000) NOT NULL,
    [creatorHandle] VARCHAR(120),
    [title] NVARCHAR(MAX) NOT NULL,
    [url] NVARCHAR(1000) NOT NULL,
    [publishedAt] DATETIME2 NOT NULL,
    [durationSeconds] INT,
    [extractionMethod] VARCHAR(80) NOT NULL,
    [reviewStatus] VARCHAR(40) NOT NULL CONSTRAINT [MarketResearchSource_reviewStatus_df] DEFAULT 'REVIEWED',
    [notes] NVARCHAR(MAX),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketResearchSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketResearchSource_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [MarketInfluenceFactor] (
    [id] VARCHAR(100) NOT NULL CONSTRAINT [MarketInfluenceFactor_id_df] DEFAULT NEWID(),
    [sourceId] VARCHAR(64) NOT NULL,
    [code] VARCHAR(64) NOT NULL,
    [category] VARCHAR(40) NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    [value] DECIMAL(18,6),
    [unit] VARCHAR(32),
    [direction] VARCHAR(32) NOT NULL,
    [directionScore] FLOAT(53) NOT NULL,
    [tailRiskScore] FLOAT(53) NOT NULL,
    [confidence] FLOAT(53) NOT NULL,
    [horizonDays] INT,
    [sourceTimestampSeconds] INT,
    [asOfDate] DATETIME2,
    [freshness] VARCHAR(32) NOT NULL CONSTRAINT [MarketInfluenceFactor_freshness_df] DEFAULT 'UNVERIFIED',
    [verificationStatus] VARCHAR(32) NOT NULL CONSTRAINT [MarketInfluenceFactor_verificationStatus_df] DEFAULT 'UNVERIFIED',
    [includeInAssessment] BIT NOT NULL CONSTRAINT [MarketInfluenceFactor_includeInAssessment_df] DEFAULT 1,
    [evidenceSummary] NVARCHAR(MAX) NOT NULL,
    [officialSourceUrl] NVARCHAR(1000),
    [notes] NVARCHAR(MAX),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketInfluenceFactor_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketInfluenceFactor_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MarketInfluenceFactor_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [MarketResearchSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [MarketRegimeAssessment] (
    [id] VARCHAR(64) NOT NULL CONSTRAINT [MarketRegimeAssessment_id_df] DEFAULT NEWID(),
    [target] VARCHAR(32) NOT NULL,
    [asOfDate] DATETIME2 NOT NULL,
    [horizonDays] INT NOT NULL,
    [status] VARCHAR(64) NOT NULL,
    [regime] VARCHAR(64) NOT NULL,
    [directionScore] FLOAT(53) NOT NULL,
    [tailRiskScore] FLOAT(53) NOT NULL,
    [evidenceConfidence] FLOAT(53) NOT NULL,
    [sourceCount] INT NOT NULL,
    [factorCount] INT NOT NULL,
    [verifiedFactorCount] INT NOT NULL,
    [bullishProbability] FLOAT(53),
    [neutralProbability] FLOAT(53),
    [bearishProbability] FLOAT(53),
    [drawdown5Probability] FLOAT(53),
    [methodologyVersion] VARCHAR(64) NOT NULL,
    [summary] NVARCHAR(MAX) NOT NULL,
    [blockersJson] NVARCHAR(MAX) NOT NULL,
    [factorSnapshotJson] NVARCHAR(MAX) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MarketRegimeAssessment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketRegimeAssessment_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [MarketResearchSource_externalId_key] ON [MarketResearchSource]([externalId]);
CREATE INDEX [MarketResearchSource_sourceType_publishedAt_idx] ON [MarketResearchSource]([sourceType], [publishedAt]);
CREATE INDEX [MarketResearchSource_creatorHandle_publishedAt_idx] ON [MarketResearchSource]([creatorHandle], [publishedAt]);
CREATE INDEX [MarketResearchSource_reviewStatus_publishedAt_idx] ON [MarketResearchSource]([reviewStatus], [publishedAt]);

CREATE UNIQUE INDEX [MarketInfluenceFactor_sourceId_code_key] ON [MarketInfluenceFactor]([sourceId], [code]);
CREATE INDEX [MarketInfluenceFactor_code_asOfDate_idx] ON [MarketInfluenceFactor]([code], [asOfDate]);
CREATE INDEX [MarketInfluenceFactor_category_asOfDate_idx] ON [MarketInfluenceFactor]([category], [asOfDate]);
CREATE INDEX [MarketInfluenceFactor_verificationStatus_freshness_idx] ON [MarketInfluenceFactor]([verificationStatus], [freshness]);

CREATE UNIQUE INDEX [MarketRegimeAssessment_target_asOfDate_horizonDays_methodologyVersion_key] ON [MarketRegimeAssessment]([target], [asOfDate], [horizonDays], [methodologyVersion]);
CREATE INDEX [MarketRegimeAssessment_target_asOfDate_idx] ON [MarketRegimeAssessment]([target], [asOfDate]);
CREATE INDEX [MarketRegimeAssessment_status_asOfDate_idx] ON [MarketRegimeAssessment]([status], [asOfDate]);
