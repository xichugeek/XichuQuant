import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { EvaluateMarketResearchDto } from "./market-research.dto";
import {
  buildMarketRegimeAssessment,
  MARKET_RESEARCH_METHODOLOGY_VERSION,
  REQUIRED_FACTOR_CODES,
  type ResearchFactorInput,
} from "./market-research.rules";

type ResearchSourceRow = Prisma.MarketResearchSourceGetPayload<{ include: { factors: true } }>;

@Injectable()
export class MarketResearchService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [sources, assessments] = await Promise.all([
      this.sources(),
      this.prisma.marketRegimeAssessment.findMany({
        orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
        take: 20,
      }),
    ]);
    const reviewedSources = sources.filter((source) => source.reviewStatus === "REVIEWED");
    const factors = this.ruleInputs(reviewedSources);
    const preview = buildMarketRegimeAssessment(factors);

    return {
      methodology: {
        version: MARKET_RESEARCH_METHODOLOGY_VERSION,
        requiredFactorCodes: REQUIRED_FACTOR_CODES,
        minimumReviewedSources: 12,
        minimumMaturedOutcomes: 30,
      },
      channelInventory: {
        creatorHandle: "@henren778",
        scannedAt: "2026-08-22",
        channelVideoCount: 782,
        accessibleLongVideoCount: 715,
        titleScreenedCandidateCount: 54,
        duplicateSkippedExternalIds: ["OGxUTvU_St0", "MrnjBdgQPLU", "Mtbfh5XA6D0", "TUt6ZwOoP7M"],
        note: "54 条标题候选已逐条处置；REVIEWED 只代表完成内容复核，不等于观点可执行。误匹配和会员受限来源均保留审计记录且不参与聚合。",
      },
      safeguards: {
        createsTradingSignal: false,
        createsOrder: false,
        creatorClaimsAreOfficialData: false,
        probabilityOutputEnabled: false,
        note: "视频观点只作为备选研究因子；未完成跨期标签和滚动回测前，不输出预测概率。",
      },
      stats: {
        sourceCount: reviewedSources.length,
        totalSourceCount: sources.length,
        candidateSourceCount: sources.filter((source) => source.reviewStatus === "CANDIDATE")
          .length,
        rejectedSourceCount: sources.filter(
          (source) => source.reviewStatus === "REJECTED_NOT_TRADING_RESEARCH",
        ).length,
        blockedSourceCount: sources.filter((source) =>
          source.reviewStatus.startsWith("ACCESS_BLOCKED"),
        ).length,
        factorCount: factors.length,
        includedFactorCount: factors.filter((factor) => factor.includeInAssessment).length,
        verifiedFactorCount: factors.filter((factor) => factor.verificationStatus === "VERIFIED")
          .length,
      },
      preview: this.serializeResult(preview),
      sources: sources.map((source) => this.serializeSource(source)),
      assessments: assessments.map((assessment) => ({
        ...assessment,
        asOfDate: assessment.asOfDate.toISOString().slice(0, 10),
        createdAt: assessment.createdAt.toISOString(),
        updatedAt: assessment.updatedAt.toISOString(),
        blockers: this.parseJson(assessment.blockersJson),
        factors: this.parseJson(assessment.factorSnapshotJson),
      })),
    };
  }

  async evaluate(dto: EvaluateMarketResearchDto) {
    const target = (dto.target?.trim() || "NDX").toUpperCase();
    const horizonDays = dto.horizonDays ?? 20;
    const asOfDate = this.utcDate(dto.asOfDate ?? new Date().toISOString().slice(0, 10));
    const endOfDay = new Date(asOfDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const sources = (await this.sources(endOfDay)).filter(
      (source) => source.reviewStatus === "REVIEWED",
    );
    const result = buildMarketRegimeAssessment(
      this.ruleInputs(sources).filter(
        (factor) => factor.asOfDate === null || factor.asOfDate.getTime() <= endOfDay.getTime(),
      ),
    );
    const factorSnapshot = result.selectedFactors.map((factor) => ({
      id: factor.id,
      sourceId: factor.sourceId,
      code: factor.code,
      label: factor.label,
      directionScore: factor.directionScore,
      tailRiskScore: factor.tailRiskScore,
      confidence: factor.confidence,
      verificationStatus: factor.verificationStatus,
      freshness: factor.freshness,
      asOfDate: factor.asOfDate?.toISOString().slice(0, 10) ?? null,
    }));

    const assessment = await this.prisma.marketRegimeAssessment.upsert({
      where: {
        target_asOfDate_horizonDays_methodologyVersion: {
          target,
          asOfDate,
          horizonDays,
          methodologyVersion: MARKET_RESEARCH_METHODOLOGY_VERSION,
        },
      },
      create: {
        target,
        asOfDate,
        horizonDays,
        status: result.status,
        regime: result.regime,
        directionScore: result.directionScore,
        tailRiskScore: result.tailRiskScore,
        evidenceConfidence: result.evidenceConfidence,
        sourceCount: result.sourceCount,
        factorCount: result.factorCount,
        verifiedFactorCount: result.verifiedFactorCount,
        methodologyVersion: MARKET_RESEARCH_METHODOLOGY_VERSION,
        summary: result.summary,
        blockersJson: JSON.stringify(result.blockers),
        factorSnapshotJson: JSON.stringify(factorSnapshot),
      },
      update: {
        status: result.status,
        regime: result.regime,
        directionScore: result.directionScore,
        tailRiskScore: result.tailRiskScore,
        evidenceConfidence: result.evidenceConfidence,
        sourceCount: result.sourceCount,
        factorCount: result.factorCount,
        verifiedFactorCount: result.verifiedFactorCount,
        bullishProbability: null,
        neutralProbability: null,
        bearishProbability: null,
        drawdown5Probability: null,
        summary: result.summary,
        blockersJson: JSON.stringify(result.blockers),
        factorSnapshotJson: JSON.stringify(factorSnapshot),
      },
    });

    return {
      assessment: {
        ...assessment,
        asOfDate: assessment.asOfDate.toISOString().slice(0, 10),
        createdAt: assessment.createdAt.toISOString(),
        updatedAt: assessment.updatedAt.toISOString(),
      },
      result: this.serializeResult(result),
    };
  }

  private sources(publishedBefore?: Date) {
    return this.prisma.marketResearchSource.findMany({
      where: publishedBefore ? { publishedAt: { lte: publishedBefore } } : undefined,
      include: { factors: { orderBy: [{ category: "asc" }, { code: "asc" }] } },
      orderBy: { publishedAt: "desc" },
    });
  }

  private ruleInputs(sources: ResearchSourceRow[]): ResearchFactorInput[] {
    return sources.flatMap((source) =>
      source.factors.map((factor) => ({
        id: factor.id,
        sourceId: source.id,
        sourcePublishedAt: source.publishedAt,
        code: factor.code,
        label: factor.label,
        category: factor.category,
        direction: factor.direction,
        directionScore: factor.directionScore,
        tailRiskScore: factor.tailRiskScore,
        confidence: factor.confidence,
        verificationStatus: factor.verificationStatus,
        freshness: factor.freshness,
        includeInAssessment: factor.includeInAssessment,
        asOfDate: factor.asOfDate,
      })),
    );
  }

  private serializeSource(source: ResearchSourceRow) {
    return {
      ...source,
      publishedAt: source.publishedAt.toISOString(),
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      factors: source.factors.map((factor) => ({
        ...factor,
        value: factor.value === null ? null : toNumber(factor.value),
        asOfDate: factor.asOfDate?.toISOString().slice(0, 10) ?? null,
        createdAt: factor.createdAt.toISOString(),
        updatedAt: factor.updatedAt.toISOString(),
      })),
    };
  }

  private serializeResult(result: ReturnType<typeof buildMarketRegimeAssessment>) {
    return {
      ...result,
      selectedFactors: result.selectedFactors.map((factor) => ({
        ...factor,
        sourcePublishedAt: factor.sourcePublishedAt.toISOString(),
        asOfDate: factor.asOfDate?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private utcDate(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
