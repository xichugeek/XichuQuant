export type MarketResearchFactor = {
  id: string;
  code: string;
  category: string;
  label: string;
  value: number | null;
  unit: string | null;
  direction: string;
  directionScore: number;
  tailRiskScore: number;
  confidence: number;
  horizonDays: number | null;
  sourceTimestampSeconds: number | null;
  asOfDate: string | null;
  freshness: string;
  verificationStatus: string;
  includeInAssessment: boolean;
  evidenceSummary: string;
  officialSourceUrl: string | null;
  notes: string | null;
};

export type MarketResearchSource = {
  id: string;
  externalId: string;
  creatorName: string;
  creatorHandle: string | null;
  title: string;
  url: string;
  publishedAt: string;
  durationSeconds: number | null;
  extractionMethod: string;
  reviewStatus: string;
  notes: string | null;
  factors: MarketResearchFactor[];
};

export type MarketResearchPreview = {
  status: "INSUFFICIENT_HISTORY" | "RESEARCH_ONLY";
  regime: string;
  directionScore: number;
  tailRiskScore: number;
  evidenceConfidence: number;
  sourceCount: number;
  factorCount: number;
  verifiedFactorCount: number;
  coveragePercent: number;
  blockers: string[];
  summary: string;
};

export type MarketResearchDashboard = {
  methodology: {
    version: string;
    requiredFactorCodes: readonly string[];
    minimumReviewedSources: number;
    minimumMaturedOutcomes: number;
  };
  channelInventory: {
    creatorHandle: string;
    scannedAt: string;
    channelVideoCount: number;
    accessibleLongVideoCount: number;
    titleScreenedCandidateCount: number;
    duplicateSkippedExternalIds: string[];
    note: string;
  };
  safeguards: {
    createsTradingSignal: boolean;
    createsOrder: boolean;
    creatorClaimsAreOfficialData: boolean;
    probabilityOutputEnabled: boolean;
    note: string;
  };
  stats: {
    sourceCount: number;
    totalSourceCount: number;
    candidateSourceCount: number;
    rejectedSourceCount: number;
    blockedSourceCount: number;
    factorCount: number;
    includedFactorCount: number;
    verifiedFactorCount: number;
  };
  preview: MarketResearchPreview;
  sources: MarketResearchSource[];
  assessments: Array<{
    id: string;
    target: string;
    asOfDate: string;
    horizonDays: number;
    status: string;
    regime: string;
    summary: string;
    createdAt: string;
  }>;
};
