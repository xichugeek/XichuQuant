import assert from "node:assert/strict";
import test from "node:test";

import { PrismaService } from "../../prisma/prisma.service";
import { MarketResearchService } from "./market-research.service";

const now = new Date("2026-08-22T00:00:00.000Z");

function source(reviewStatus: string, suffix: string) {
  return {
    id: `source-${suffix}`,
    sourceType: "YOUTUBE",
    externalId: `video-${suffix}`,
    creatorName: "一个狠人",
    creatorHandle: "@henren778",
    title: `source ${suffix}`,
    url: `https://www.youtube.com/watch?v=video-${suffix}`,
    publishedAt: now,
    durationSeconds: 600,
    extractionMethod: "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
    reviewStatus,
    notes: null,
    createdAt: now,
    updatedAt: now,
    factors: [
      {
        id: `factor-${suffix}`,
        sourceId: `source-${suffix}`,
        code: `FACTOR_${suffix.toUpperCase()}`,
        category: "MODEL_RISK",
        label: `factor ${suffix}`,
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 80,
        confidence: 90,
        horizonDays: null,
        sourceTimestampSeconds: 60,
        asOfDate: now,
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: true,
        evidenceSummary: "test evidence",
        officialSourceUrl: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

test("dashboard 只聚合 REVIEWED 来源并分别统计候选、误匹配和访问受限来源", async () => {
  const sources = [
    source("REVIEWED", "reviewed"),
    source("CANDIDATE", "candidate"),
    source("REJECTED_NOT_TRADING_RESEARCH", "rejected"),
    source("ACCESS_BLOCKED_MEMBER", "blocked"),
  ];
  const prisma = {
    marketResearchSource: { findMany: async () => sources },
    marketRegimeAssessment: { findMany: async () => [] },
  } as unknown as PrismaService;

  const dashboard = await new MarketResearchService(prisma).dashboard();

  assert.equal(dashboard.stats.sourceCount, 1);
  assert.equal(dashboard.stats.totalSourceCount, 4);
  assert.equal(dashboard.stats.candidateSourceCount, 1);
  assert.equal(dashboard.stats.rejectedSourceCount, 1);
  assert.equal(dashboard.stats.blockedSourceCount, 1);
  assert.equal(dashboard.stats.factorCount, 1);
  assert.deepEqual(
    dashboard.preview.selectedFactors.map((factor) => factor.id),
    ["factor-reviewed"],
  );
});
