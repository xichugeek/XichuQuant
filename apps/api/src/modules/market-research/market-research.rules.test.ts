import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketRegimeAssessment,
  REQUIRED_FACTOR_CODES,
  type ResearchFactorInput,
} from "./market-research.rules";

function factor(overrides: Partial<ResearchFactorInput> = {}): ResearchFactorInput {
  return {
    id: "factor-1",
    sourceId: "source-1",
    sourcePublishedAt: new Date("2026-08-01T00:00:00.000Z"),
    code: "MARGIN_DEBT_MOM",
    label: "融资余额月环比",
    category: "LEVERAGE",
    direction: "CONDITIONAL",
    directionScore: 40,
    tailRiskScore: 75,
    confidence: 80,
    verificationStatus: "VERIFIED",
    freshness: "CURRENT",
    includeInAssessment: true,
    asOfDate: new Date("2026-07-31T00:00:00.000Z"),
    ...overrides,
  };
}

test("同一因子代码只采用发布日期最新的来源，避免重复计票", () => {
  const result = buildMarketRegimeAssessment([
    factor({
      id: "old",
      sourceId: "old-source",
      sourcePublishedAt: new Date("2026-05-01T00:00:00.000Z"),
      directionScore: 100,
    }),
    factor({
      id: "new",
      sourceId: "new-source",
      sourcePublishedAt: new Date("2026-08-01T00:00:00.000Z"),
      directionScore: -100,
    }),
  ]);

  assert.equal(result.factorCount, 1);
  assert.equal(result.selectedFactors[0]?.id, "new");
  assert.equal(result.directionScore, -100);
});

test("已核验的当前数据权重高于同置信度的陈旧未核验数据", () => {
  const result = buildMarketRegimeAssessment([
    factor({ code: "MARGIN_DEBT_MOM", directionScore: 60 }),
    factor({
      id: "stale",
      sourceId: "source-2",
      code: "BUFFETT_INDICATOR",
      directionScore: -60,
      verificationStatus: "UNVERIFIED",
      freshness: "STALE",
    }),
  ]);

  assert.ok(result.directionScore > 50);
});

test("高方向分与高尾部风险会标记为风险偏好但交易拥挤", () => {
  const factors = REQUIRED_FACTOR_CODES.map((code, index) =>
    factor({
      id: `factor-${index}`,
      sourceId: `source-${index}`,
      code,
      directionScore: 50,
      tailRiskScore: 80,
    }),
  );
  const result = buildMarketRegimeAssessment(factors);

  assert.equal(result.coveragePercent, 100);
  assert.equal(result.regime, "RISK_ON_CROWDED");
});

test("样本和到期结果不足时只给研究状态，不伪造预测概率", () => {
  const result = buildMarketRegimeAssessment([factor()]);

  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.ok(result.blockers.some((item) => item.includes("至少需要 12 条")));
  assert.ok(result.blockers.some((item) => item.includes("30 条到期预测")));
  assert.match(result.summary, /不输出上涨、下跌或回撤概率/);
});

test("作者情景预测可以归档，但不得进入市场状态聚合", () => {
  const result = buildMarketRegimeAssessment([
    factor(),
    factor({
      id: "creator-target",
      code: "NDX_CEILING_FORECAST",
      includeInAssessment: false,
      directionScore: 100,
    }),
  ]);

  assert.equal(result.factorCount, 1);
  assert.ok(!result.selectedFactors.some((item) => item.code === "NDX_CEILING_FORECAST"));
});

test("来源、因子覆盖和到期结果都达标后才进入仅供研究状态", () => {
  const covered = REQUIRED_FACTOR_CODES.map((code, index) =>
    factor({ id: `covered-${index}`, sourceId: `source-${index}`, code }),
  );
  const olderDuplicates = [9, 10, 11].map((index) =>
    factor({
      id: `older-${index}`,
      sourceId: `source-${index}`,
      sourcePublishedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  const result = buildMarketRegimeAssessment([...covered, ...olderDuplicates], {
    maturedOutcomeCount: 30,
  });

  assert.equal(result.sourceCount, 12);
  assert.equal(result.status, "RESEARCH_ONLY");
  assert.deepEqual(result.blockers, []);
});
