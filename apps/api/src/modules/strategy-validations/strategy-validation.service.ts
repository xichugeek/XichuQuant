import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { QuantEngineClient } from "../quant-engine/quant-engine.client";
import { RiskEngineService } from "../risk/risk-engine.service";
import type { RiskRuleInput } from "../risk/risk.types";
import { StrategyEvidenceService } from "../strategy-evidence/strategy-evidence.service";
import type {
  DecideStrategyApprovalDto,
  RunStrategyValidationDto,
} from "./strategy-validation.dto";

const MAX_VALIDATION_BARS = 10_000;

type ValidationMetrics = Record<string, number | null>;
type MarketDataRow = Prisma.MarketDataDailyGetPayload<Record<string, never>>;
type ValidationResult = {
  engineVersion: string;
  split: Record<string, string | number>;
  inSample: { metrics: ValidationMetrics; equityPoints: unknown[]; trades: unknown[] };
  outSample: { metrics: ValidationMetrics; equityPoints: unknown[]; trades: unknown[] };
  walkForwardWindows: Array<{
    sequence: number;
    windowType: string;
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    parameters: Record<string, unknown>;
    trainMetrics: ValidationMetrics;
    testMetrics: ValidationMetrics;
    testEquityPoints: unknown[];
    testTrades: unknown[];
  }>;
  parameterSweep: {
    dimensions: Record<string, unknown>;
    summary: Record<string, unknown>;
    results: Array<{
      parameters: Record<string, unknown>;
      metrics: ValidationMetrics;
      stabilityScore: number;
      flags: string[];
    }>;
  };
  stressTest: {
    baselineMetrics: ValidationMetrics;
    summary: Record<string, unknown>;
    results: Array<{
      scenarioCode: string;
      config: Record<string, unknown>;
      metrics: ValidationMetrics;
      returnDegradation: number;
      failed: boolean;
    }>;
  };
  regimeMetrics: Record<string, unknown>;
  crossSymbolMetrics: Record<string, unknown>;
  warnings: Array<Record<string, string>>;
  approvalCriteria: Record<string, boolean>;
  robustnessScore: number;
  recommendation: string;
};

@Injectable()
export class StrategyValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantEngine: QuantEngineClient,
    private readonly riskEngine: RiskEngineService,
    private readonly strategyEvidence: StrategyEvidenceService,
  ) {}

  async list() {
    const runs = await this.prisma.strategyValidationRun.findMany({
      include: {
        strategy: { select: { approvalStatus: true, code: true, name: true, strategyType: true } },
        _count: {
          select: { approvals: true, parameterSweeps: true, stressTests: true, windows: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return runs.map((run) => this.serializeRun(run));
  }

  async run(dto: RunStrategyValidationDto) {
    const strategy = await this.prisma.strategy.findUnique({ where: { id: dto.strategyId } });
    if (!strategy || !strategy.enabled) throw new NotFoundException("策略不存在或已停用");
    const symbol = dto.symbol.toUpperCase();
    const source = dto.marketDataSource ?? "SEED_V1_3";
    const startDate = dto.startDate
      ? this.utcDate(dto.startDate)
      : new Date("2023-01-03T00:00:00Z");
    const endDate = dto.endDate ? this.utcDate(dto.endDate) : new Date("2026-07-17T00:00:00Z");
    const bars = await this.loadBars(symbol, source, startDate, endDate);
    if (bars.length < 120) throw new BadRequestException("稳健性验证至少需要 120 根日线行情");
    const crossSymbols = [
      ...new Set((dto.crossSymbols ?? ["QQQM", "MUU"]).map((item) => item.toUpperCase())),
    ].filter((item) => item !== symbol);
    const crossSymbolBars = Object.fromEntries(
      await Promise.all(
        crossSymbols.map(async (item) => [
          item,
          await this.loadBars(item, source, startDate, endDate),
        ]),
      ),
    ) as Record<string, MarketDataRow[]>;
    const parameters = JSON.parse(strategy.parameters) as Record<string, unknown>;
    const walkForward = {
      anchored: true,
      maxWindows: 6,
      testMonths: 6,
      trainMonths: 18,
      ...(dto.walkForward ?? {}),
    };
    const parameterGrid = dto.parameterGrid ?? {};
    const run = await this.prisma.strategyValidationRun.create({
      data: {
        strategyId: strategy.id,
        status: "RUNNING",
        symbolsJson: JSON.stringify([symbol, ...crossSymbols]),
        marketDataSource: source,
        marketDataStart: bars[0]!.tradeDate,
        marketDataEnd: bars.at(-1)!.tradeDate,
        inSampleRatio: dto.inSampleRatio ?? 0.7,
        walkForwardConfigJson: JSON.stringify(walkForward),
        parameterGridJson: JSON.stringify(parameterGrid),
        stressConfigJson: JSON.stringify({ deterministicSeed: 42, scenarios: 11 }),
        parameterSnapshot: strategy.parameters,
        randomSeed: 42,
        codeVersion: process.env.GIT_COMMIT ?? "v1.4.0-local",
        startedAt: new Date(),
      },
    });
    await this.prisma.strategy.update({
      where: { id: strategy.id },
      data: { approvalStatus: "VALIDATING" },
    });
    try {
      const evidence =
        strategy.strategyType === "FundamentalLiquidityCrowding"
          ? await this.strategyEvidence.quantObservations(
              symbol,
              bars[0]!.tradeDate,
              bars.at(-1)!.tradeDate,
            )
          : [];
      const result = await this.quantEngine.runValidation<ValidationResult>({
        strategyType: strategy.strategyType,
        parameters,
        evidence,
        bars: bars.map((bar) => this.mapBar(bar)),
        crossSymbolBars: Object.fromEntries(
          Object.entries(crossSymbolBars).map(([key, rows]) => [
            key,
            rows.map((bar) => this.mapBar(bar)),
          ]),
        ),
        initialCapital: toNumber(strategy.initialCapital),
        commissionRate: toNumber(strategy.commissionRate),
        slippageRate: toNumber(strategy.slippageRate),
        inSampleRatio: dto.inSampleRatio ?? 0.7,
        walkForward,
        parameterGrid,
        randomSeed: 42,
        minimumOutOfSampleTrades: dto.minimumOutOfSampleTrades ?? 20,
      });
      await this.persist(run.id, strategy.id, result);
      return this.get(run.id);
    } catch (error: unknown) {
      await this.prisma.$transaction([
        this.prisma.strategyValidationRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : "策略验证失败",
          },
        }),
        this.prisma.strategy.update({
          where: { id: strategy.id },
          data: { approvalStatus: "BACKTESTED" },
        }),
      ]);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : "策略验证失败");
    }
  }

  async get(id: string) {
    const run = await this.prisma.strategyValidationRun.findUnique({
      where: { id },
      include: {
        approvals: { orderBy: { decisionVersion: "desc" } },
        parameterSweeps: { include: { results: true } },
        strategy: true,
        stressTests: { include: { results: true } },
        windows: { orderBy: { sequence: "asc" } },
      },
    });
    if (!run) throw new NotFoundException("策略验证任务不存在");
    return {
      ...this.serializeRun(run),
      approvals: run.approvals.map((approval) => ({
        ...approval,
        criteria: JSON.parse(approval.criteriaJson),
        reasons: JSON.parse(approval.reasonsJson),
        riskResult: approval.riskResultJson ? JSON.parse(approval.riskResultJson) : null,
      })),
      parameterSweeps: run.parameterSweeps.map((sweep) => ({
        ...sweep,
        dimensions: JSON.parse(sweep.dimensionsJson),
        summary: sweep.stabilitySummaryJson ? JSON.parse(sweep.stabilitySummaryJson) : {},
        results: sweep.results.map((item) => ({
          ...item,
          flags: item.flagsJson ? JSON.parse(item.flagsJson) : [],
          parameters: JSON.parse(item.parametersJson),
          maxDrawdown: toNumber(item.maxDrawdown),
          profitFactor: item.profitFactor === null ? null : toNumber(item.profitFactor),
          sharpeRatio: item.sharpeRatio === null ? null : toNumber(item.sharpeRatio),
          stabilityScore: item.stabilityScore === null ? null : toNumber(item.stabilityScore),
          totalReturn: toNumber(item.totalReturn),
        })),
      })),
      stressTests: run.stressTests.map((test) => ({
        ...test,
        baselineMetrics: test.baselineMetricsJson ? JSON.parse(test.baselineMetricsJson) : {},
        summary: test.summaryJson ? JSON.parse(test.summaryJson) : {},
        results: test.results.map((item) => ({
          ...item,
          config: JSON.parse(item.scenarioConfigJson),
          metrics: JSON.parse(item.metricsJson),
          maxDrawdown: toNumber(item.maxDrawdown),
          returnDegradation: toNumber(item.returnDegradation),
          totalReturn: toNumber(item.totalReturn),
        })),
      })),
      windows: run.windows.map((window) => ({
        ...window,
        parameters: JSON.parse(window.parameterSnapshot),
        trainMetrics: window.trainMetricsJson ? JSON.parse(window.trainMetricsJson) : {},
        testMetrics: JSON.parse(window.testMetricsJson),
        maxDrawdown: window.maxDrawdown === null ? null : toNumber(window.maxDrawdown),
        profitFactor: window.profitFactor === null ? null : toNumber(window.profitFactor),
        sharpeRatio: window.sharpeRatio === null ? null : toNumber(window.sharpeRatio),
        totalReturn: window.totalReturn === null ? null : toNumber(window.totalReturn),
      })),
    };
  }

  async decide(id: string, dto: DecideStrategyApprovalDto) {
    if (!dto.userConfirmed) throw new BadRequestException("进入模拟交易前必须人工确认审批决定");
    const run = await this.prisma.strategyValidationRun.findUnique({
      where: { id },
      include: { strategy: true, approvals: true },
    });
    if (!run || run.status !== "COMPLETED")
      throw new BadRequestException("只有已完成的验证可以审批");
    const dbRules = await this.prisma.riskRule.findMany({ where: { enabled: true } });
    const riskResult = this.riskEngine.evaluate(
      {
        id: "paper-validation",
        name: "策略审批模拟账户",
        totalEquity: 100000,
        cashBalance: 100000,
        realizedPnlYtd: 0,
      },
      [],
      dbRules.map<RiskRuleInput>((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        level: rule.level,
        limitValue: toNumber(rule.limitValue),
      })),
    );
    const quantCriteria = JSON.parse(run.warningsJson ?? "{}") as {
      approvalCriteria?: Record<string, boolean>;
    };
    const criteria = {
      ...(quantCriteria.approvalCriteria ?? {}),
      completed: run.status === "COMPLETED",
      riskEngineReview: riskResult.overallRiskLevel !== "VIOLATION",
      quantRecommendation: run.recommendation === "PAPER_APPROVE_CANDIDATE",
    };
    const approved = Object.values(criteria).every(Boolean);
    const reasons = approved
      ? ["稳健性条件与统一风控审查均通过，可由用户部署到独立模拟账户。"]
      : Object.entries(criteria)
          .filter(([, passed]) => !passed)
          .map(([name]) => `审批条件未通过：${name}`);
    const decisionVersion = run.approvals.length + 1;
    const approval = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.strategyApproval.create({
        data: {
          strategyId: run.strategyId,
          validationRunId: run.id,
          decisionVersion,
          status: approved ? "APPROVED" : "REJECTED",
          userConfirmed: true,
          criteriaJson: JSON.stringify(criteria),
          reasonsJson: JSON.stringify(reasons),
          riskResultJson: JSON.stringify(riskResult),
          decidedAt: new Date(),
        },
      });
      await transaction.strategy.update({
        where: { id: run.strategyId },
        data: { approvalStatus: approved ? "PAPER_APPROVED" : "REJECTED" },
      });
      return created;
    });
    return {
      ...approval,
      approved,
      criteria,
      reasons,
      riskResult,
    };
  }

  private async persist(runId: string, strategyId: string, result: ValidationResult) {
    await this.prisma.$transaction(async (transaction) => {
      if (result.walkForwardWindows.length > 0) {
        await transaction.validationWindow.createMany({
          data: result.walkForwardWindows.map((window) => ({
            validationRunId: runId,
            sequence: window.sequence,
            windowType: window.windowType,
            trainStart: this.utcDate(window.trainStart),
            trainEnd: this.utcDate(window.trainEnd),
            testStart: this.utcDate(window.testStart),
            testEnd: this.utcDate(window.testEnd),
            parameterSnapshot: JSON.stringify(window.parameters),
            trainMetricsJson: JSON.stringify(window.trainMetrics),
            testMetricsJson: JSON.stringify(window.testMetrics),
            testEquityJson: JSON.stringify(window.testEquityPoints),
            testTradesJson: JSON.stringify(window.testTrades),
            totalReturn: window.testMetrics.totalReturn,
            maxDrawdown: window.testMetrics.maxDrawdown,
            sharpeRatio: window.testMetrics.sharpeRatio,
            profitFactor: window.testMetrics.profitFactor,
            tradeCount: window.testMetrics.executionCount ?? 0,
          })),
        });
      }
      const sweep = await transaction.parameterSweepRun.create({
        data: {
          validationRunId: runId,
          strategyId,
          status: "COMPLETED",
          dimensionsJson: JSON.stringify(result.parameterSweep.dimensions),
          stabilitySummaryJson: JSON.stringify(result.parameterSweep.summary),
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (result.parameterSweep.results.length > 0) {
        await transaction.parameterSweepResult.createMany({
          data: result.parameterSweep.results.map((row) => ({
            sweepRunId: sweep.id,
            parameterKey: this.parameterKey(row.parameters),
            parametersJson: JSON.stringify(row.parameters),
            totalReturn: row.metrics.totalReturn ?? 0,
            maxDrawdown: row.metrics.maxDrawdown ?? 0,
            sharpeRatio: row.metrics.sharpeRatio,
            profitFactor: row.metrics.profitFactor,
            tradeCount: row.metrics.executionCount ?? 0,
            stabilityScore: row.stabilityScore,
            flagsJson: JSON.stringify(row.flags),
          })),
        });
      }
      const stress = await transaction.stressTestRun.create({
        data: {
          validationRunId: runId,
          strategyId,
          status: "COMPLETED",
          baselineMetricsJson: JSON.stringify(result.stressTest.baselineMetrics),
          summaryJson: JSON.stringify(result.stressTest.summary),
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await transaction.stressTestResult.createMany({
        data: result.stressTest.results.map((row) => ({
          stressTestRunId: stress.id,
          scenarioCode: row.scenarioCode,
          scenarioConfigJson: JSON.stringify(row.config),
          metricsJson: JSON.stringify(row.metrics),
          totalReturn: row.metrics.totalReturn ?? 0,
          maxDrawdown: row.metrics.maxDrawdown ?? 0,
          returnDegradation: row.returnDegradation,
          tradeCount: row.metrics.executionCount ?? 0,
          failed: row.failed,
        })),
      });
      await transaction.strategyValidationRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          quantEngineVersion: result.engineVersion,
          inSampleMetricsJson: JSON.stringify(result.inSample.metrics),
          outSampleMetricsJson: JSON.stringify(result.outSample.metrics),
          regimeMetricsJson: JSON.stringify(result.regimeMetrics),
          crossSymbolMetricsJson: JSON.stringify(result.crossSymbolMetrics),
          warningsJson: JSON.stringify({
            approvalCriteria: result.approvalCriteria,
            warnings: result.warnings,
          }),
          robustnessScore: result.robustnessScore,
          recommendation: result.recommendation,
        },
      });
      await transaction.strategy.update({
        where: { id: strategyId },
        data: { approvalStatus: "BACKTESTED" },
      });
    });
  }

  private async loadBars(symbol: string, source: string, startDate: Date, endDate: Date) {
    return this.prisma.marketDataDaily.findMany({
      where: { symbol, source, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: "asc" },
      take: MAX_VALIDATION_BARS,
    });
  }

  private mapBar(bar: MarketDataRow) {
    return {
      symbol: bar.symbol,
      tradeDate: bar.tradeDate.toISOString().slice(0, 10),
      open: toNumber(bar.open),
      high: toNumber(bar.high),
      low: toNumber(bar.low),
      close: toNumber(bar.close),
      adjustedClose: toNumber(bar.adjustedClose),
      volume: toNumber(bar.volume),
      dividend: toNumber(bar.dividend),
      splitFactor: toNumber(bar.splitFactor),
      currency: bar.currency,
      source: bar.source,
    };
  }

  private serializeRun<T extends Prisma.StrategyValidationRunGetPayload<Record<string, never>>>(
    run: T,
  ) {
    const warningPayload = run.warningsJson
      ? (JSON.parse(run.warningsJson) as { approvalCriteria?: unknown; warnings?: unknown })
      : {};
    return {
      ...run,
      symbols: JSON.parse(run.symbolsJson),
      parameters: JSON.parse(run.parameterSnapshot),
      inSampleMetrics: run.inSampleMetricsJson ? JSON.parse(run.inSampleMetricsJson) : null,
      outSampleMetrics: run.outSampleMetricsJson ? JSON.parse(run.outSampleMetricsJson) : null,
      regimeMetrics: run.regimeMetricsJson ? JSON.parse(run.regimeMetricsJson) : {},
      crossSymbolMetrics: run.crossSymbolMetricsJson ? JSON.parse(run.crossSymbolMetricsJson) : {},
      approvalCriteria: warningPayload.approvalCriteria ?? {},
      warnings: warningPayload.warnings ?? [],
      robustnessScore: run.robustnessScore === null ? null : toNumber(run.robustnessScore),
    };
  }

  private parameterKey(parameters: Record<string, unknown>) {
    return Object.entries(parameters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("|")
      .slice(0, 200);
  }

  private utcDate(input: string) {
    const date = new Date(`${input.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return date;
  }
}
