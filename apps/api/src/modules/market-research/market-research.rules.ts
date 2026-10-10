export const MARKET_RESEARCH_METHODOLOGY_VERSION = "market-factor-regime-v1";

export const REQUIRED_FACTOR_CODES = [
  "MARGIN_DEBT_MOM",
  "SPX_0DTE_SHARE",
  "BUFFETT_INDICATOR",
  "TOP10_CONCENTRATION",
  "M2_NDX_GAP",
  "FORWARD_PE",
  "DEALER_GAMMA_STATE",
  "NDX_TREND_RECLAIM",
  "MARKET_BREADTH",
] as const;

export type ResearchFactorInput = {
  id: string;
  sourceId: string;
  sourcePublishedAt: Date;
  code: string;
  label: string;
  category: string;
  direction: string;
  directionScore: number;
  tailRiskScore: number;
  confidence: number;
  verificationStatus: string;
  freshness: string;
  includeInAssessment: boolean;
  asOfDate: Date | null;
};

export type MarketRegimeResult = {
  status: "INSUFFICIENT_HISTORY" | "RESEARCH_ONLY";
  regime:
    | "RISK_ON"
    | "RISK_ON_CROWDED"
    | "RISK_OFF"
    | "RISK_OFF_STRESSED"
    | "DIRECTIONAL_UNCLEAR_HIGH_TAIL_RISK"
    | "NEUTRAL";
  directionScore: number;
  tailRiskScore: number;
  evidenceConfidence: number;
  sourceCount: number;
  factorCount: number;
  verifiedFactorCount: number;
  coveragePercent: number;
  blockers: string[];
  selectedFactors: ResearchFactorInput[];
  summary: string;
};

const verificationWeights: Record<string, number> = {
  VERIFIED: 1,
  PARTIAL: 0.65,
  UNVERIFIED: 0.25,
  STALE: 0.15,
};

const freshnessWeights: Record<string, number> = {
  CURRENT: 1,
  LAGGED: 0.6,
  HISTORICAL: 0.35,
  STALE: 0.2,
  UNVERIFIED: 0.2,
};

function round(value: number) {
  return Number(value.toFixed(2));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function selectLatestFactorPerCode(factors: ResearchFactorInput[]) {
  const selected = new Map<string, ResearchFactorInput>();
  for (const factor of factors
    .filter((item) => item.includeInAssessment)
    .sort((a, b) => b.sourcePublishedAt.getTime() - a.sourcePublishedAt.getTime())) {
    if (!selected.has(factor.code)) selected.set(factor.code, factor);
  }
  return [...selected.values()];
}

export function buildMarketRegimeAssessment(
  factors: ResearchFactorInput[],
  options: { maturedOutcomeCount?: number } = {},
): MarketRegimeResult {
  const selectedFactors = selectLatestFactorPerCode(factors);
  const sourceCount = new Set(factors.map((factor) => factor.sourceId)).size;
  const verifiedFactorCount = selectedFactors.filter(
    (factor) => factor.verificationStatus === "VERIFIED",
  ).length;
  const coveredCodes = new Set(selectedFactors.map((factor) => factor.code));
  const coveragePercent =
    (REQUIRED_FACTOR_CODES.filter((code) => coveredCodes.has(code)).length /
      REQUIRED_FACTOR_CODES.length) *
    100;

  let totalWeight = 0;
  let directionWeighted = 0;
  let tailRiskWeighted = 0;
  for (const factor of selectedFactors) {
    const weight =
      clamp(factor.confidence, 0, 100) /
      100 *
      (verificationWeights[factor.verificationStatus] ?? 0.2) *
      (freshnessWeights[factor.freshness] ?? 0.2);
    totalWeight += weight;
    directionWeighted += clamp(factor.directionScore, -100, 100) * weight;
    tailRiskWeighted += clamp(factor.tailRiskScore, 0, 100) * weight;
  }

  const directionScore = totalWeight > 0 ? directionWeighted / totalWeight : 0;
  const tailRiskScore = totalWeight > 0 ? tailRiskWeighted / totalWeight : 0;
  const verifiedPercent = selectedFactors.length
    ? (verifiedFactorCount / selectedFactors.length) * 100
    : 0;
  const evidenceConfidence = clamp(
    coveragePercent * 0.45 + verifiedPercent * 0.35 + Math.min(sourceCount / 12, 1) * 20,
    0,
    100,
  );

  let regime: MarketRegimeResult["regime"] = "NEUTRAL";
  if (directionScore >= 20 && tailRiskScore >= 65) regime = "RISK_ON_CROWDED";
  else if (directionScore >= 20) regime = "RISK_ON";
  else if (directionScore <= -20 && tailRiskScore >= 65) regime = "RISK_OFF_STRESSED";
  else if (directionScore <= -20) regime = "RISK_OFF";
  else if (tailRiskScore >= 65) regime = "DIRECTIONAL_UNCLEAR_HIGH_TAIL_RISK";

  const blockers: string[] = [];
  if (sourceCount < 12) blockers.push(`只有 ${sourceCount} 条已审阅来源，至少需要 12 条跨期样本`);
  if (coveragePercent < 80)
    blockers.push(`必需因子覆盖率仅 ${round(coveragePercent)}%，至少需要 80%`);
  const maturedOutcomeCount = options.maturedOutcomeCount ?? 0;
  if (maturedOutcomeCount < 30)
    blockers.push(
      `只有 ${maturedOutcomeCount} 条到期预测结果；至少需要 30 条到期预测的结果标签与滚动回测`,
    );

  const status: MarketRegimeResult["status"] =
    blockers.length > 0 ? "INSUFFICIENT_HISTORY" : "RESEARCH_ONLY";
  const regimeLabel: Record<MarketRegimeResult["regime"], string> = {
    RISK_ON: "风险偏好",
    RISK_ON_CROWDED: "风险偏好但交易拥挤",
    RISK_OFF: "风险规避",
    RISK_OFF_STRESSED: "风险规避且压力较高",
    DIRECTIONAL_UNCLEAR_HIGH_TAIL_RISK: "方向不清但尾部风险偏高",
    NEUTRAL: "中性",
  };
  const summary = `${regimeLabel[regime]}：方向分 ${round(directionScore)}，尾部风险分 ${round(tailRiskScore)}。${
    status === "INSUFFICIENT_HISTORY"
      ? "当前只展示因子状态，不输出上涨、下跌或回撤概率。"
      : "仅用于研究观察，不得直接生成交易指令。"
  }`;

  return {
    status,
    regime,
    directionScore: round(directionScore),
    tailRiskScore: round(tailRiskScore),
    evidenceConfidence: round(evidenceConfidence),
    sourceCount,
    factorCount: selectedFactors.length,
    verifiedFactorCount,
    coveragePercent: round(coveragePercent),
    blockers,
    selectedFactors,
    summary,
  };
}
