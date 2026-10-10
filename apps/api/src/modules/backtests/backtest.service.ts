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
import { SignalService } from "../signals/signal.service";
import { StrategyEvidenceService } from "../strategy-evidence/strategy-evidence.service";
import type { RunBacktestDto } from "./backtest.dto";

type QuantBacktestResult = {
  engineVersion: string;
  metrics: Record<string, number | null>;
  monthlyReturns: Array<{ month: string; return: number }>;
  equityPoints: Array<{
    tradeDate: string;
    equity: number;
    cash: number;
    positionValue: number;
    drawdown: number;
    benchmarkEquity: number;
  }>;
  trades: Array<{
    symbol: string;
    side: string;
    signalTime: string;
    orderTime: string;
    executionTime: string;
    executionPrice: number;
    quantity: number;
    notional: number;
    commission: number;
    slippage: number;
    realizedPnl: number | null;
    holdingDays: number | null;
    triggerReason: string;
  }>;
  positions: Array<{
    symbol: string;
    quantity: number;
    avgCost: number;
    lastPrice: number;
    marketValue: number;
    unrealizedPnl: number;
  }>;
  signals: Array<{
    symbol: string;
    side: string;
    signalTime: string;
    referencePrice: number;
    requestedAmount: number;
    stopLossCondition: string | null;
    exitCondition: string | null;
    reason: string;
  }>;
  riskNotice: string;
};

const MAX_BACKTEST_BARS = 10_000;
const IBKR_US_EQUITY_TIERED_BASE = {
  commissionPerShare: 0.0035,
  minimumCommissionPerOrder: 0.35,
  maximumCommissionRate: 0.01,
} as const;

@Injectable()
export class BacktestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantEngine: QuantEngineClient,
    private readonly signals: SignalService,
    private readonly strategyEvidence: StrategyEvidenceService,
  ) {}

  async list() {
    const runs = await this.prisma.backtestRun.findMany({
      include: { strategy: { select: { code: true, name: true, strategyType: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return runs.map((run) => this.serializeRun(run));
  }

  async run(dto: RunBacktestDto) {
    const strategy = await this.prisma.strategy.findUnique({ where: { id: dto.strategyId } });
    if (!strategy || !strategy.enabled) throw new NotFoundException("策略不存在或已停用");
    const symbol = dto.symbol.toUpperCase();
    const universe = JSON.parse(strategy.symbolUniverse) as string[];
    if (!universe.includes(symbol)) throw new BadRequestException("所选标的不在策略标的池中");
    const startDate = this.utcDate(dto.startDate);
    const endDate = this.utcDate(dto.endDate);
    if (endDate <= startDate) throw new BadRequestException("结束日期必须晚于开始日期");
    const marketDataSource = dto.marketDataSource ?? "SEED_V1_3";
    const parameters =
      dto.parameters ?? (JSON.parse(strategy.parameters) as Record<string, unknown>);
    const backtestSymbols = this.backtestSymbols(strategy.strategyType, parameters, symbol);
    const outsideUniverse = backtestSymbols.filter((item) => !universe.includes(item));
    if (outsideUniverse.length > 0) {
      throw new BadRequestException(`策略参数包含标的池外资产：${outsideUniverse.join(", ")}`);
    }
    const warmupCount = this.warmupCount(strategy.strategyType, parameters);
    const evaluationBars = await this.prisma.marketDataDaily.findMany({
      where: {
        symbol: { in: backtestSymbols },
        source: marketDataSource,
        tradeDate: { gte: startDate, lte: endDate },
      },
      orderBy: [{ tradeDate: "asc" }, { symbol: "asc" }],
      take: MAX_BACKTEST_BARS * backtestSymbols.length,
    });
    const evaluationPrimaryBars = evaluationBars.filter((bar) => bar.symbol === symbol);
    if (evaluationPrimaryBars.length < 2)
      throw new BadRequestException("所选范围内没有足够的基准日线行情");
    for (const requiredSymbol of backtestSymbols) {
      if (evaluationBars.filter((bar) => bar.symbol === requiredSymbol).length < 2) {
        throw new BadRequestException(`所选范围内缺少 ${requiredSymbol} 的日线行情`);
      }
    }
    const warmupBars =
      warmupCount > 0
        ? (
            await Promise.all(
              backtestSymbols.map(async (requiredSymbol) => {
                const rows = await this.prisma.marketDataDaily.findMany({
                  where: {
                    symbol: requiredSymbol,
                    source: marketDataSource,
                    tradeDate: { lt: startDate },
                  },
                  orderBy: { tradeDate: "desc" },
                  take: warmupCount,
                });
                if (rows.length < warmupCount) {
                  throw new BadRequestException(
                    `策略需要 ${requiredSymbol} 在起始日前有 ${warmupCount} 根暖机行情，当前只有 ${rows.length} 根`,
                  );
                }
                return rows.reverse();
              }),
            )
          ).flat()
        : [];
    const bars = [...warmupBars, ...evaluationBars];
    const account = dto.accountId
      ? await this.prisma.account.findUnique({ where: { id: dto.accountId } })
      : await this.prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
    const initialCapital = dto.initialCapital ?? toNumber(strategy.initialCapital);
    const commissionModel = dto.commissionModel ?? "PERCENT_NOTIONAL";
    const commissionRate =
      commissionModel === "IBKR_US_EQUITY_TIERED_BASE"
        ? 0
        : (dto.commissionRate ?? toNumber(strategy.commissionRate));
    const executionCostModel =
      commissionModel === "IBKR_US_EQUITY_TIERED_BASE"
        ? {
            model: commissionModel,
            ...IBKR_US_EQUITY_TIERED_BASE,
            externalFeesIncluded: false,
            officialSourceUrl:
              "https://www.interactivebrokers.com/en/pricing/commissions-stocks.php",
          }
        : { model: commissionModel, commissionRate };
    const slippageRate = dto.slippageRate ?? toNumber(strategy.slippageRate);
    const randomSeed = dto.randomSeed ?? 42;
    const run = await this.prisma.backtestRun.create({
      data: {
        strategyId: strategy.id,
        status: "PENDING",
        symbol,
        strategyVersion: strategy.version,
        parameterSnapshot: JSON.stringify({ ...parameters, executionCostModel }),
        marketDataSource,
        marketDataStart: evaluationPrimaryBars[0]!.tradeDate,
        marketDataEnd: evaluationPrimaryBars.at(-1)!.tradeDate,
        initialCapital,
        commissionRate,
        slippageRate,
        randomSeed,
        codeVersion: process.env.GIT_COMMIT ?? "v1.3.0-local",
      },
    });
    const startedAt = Date.now();
    await this.prisma.backtestRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    try {
      const evidence =
        strategy.strategyType === "FundamentalLiquidityCrowding"
          ? await this.strategyEvidence.quantObservations(
              symbol,
              evaluationPrimaryBars[0]!.tradeDate,
              evaluationPrimaryBars.at(-1)!.tradeDate,
            )
          : [];
      const result = await this.quantEngine.runBacktest<QuantBacktestResult>({
        strategyType: strategy.strategyType,
        parameters,
        initialCapital,
        commissionModel,
        commissionRate,
        ...IBKR_US_EQUITY_TIERED_BASE,
        slippageRate,
        randomSeed,
        priceMode: dto.priceMode ?? "ADJUSTED",
        evaluationStartDate: evaluationPrimaryBars[0]!.tradeDate.toISOString().slice(0, 10),
        evidence,
        bars: bars.map((bar) => ({
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
        })),
      });
      await this.persistResult(
        run.id,
        strategy.id,
        account?.id ?? null,
        result,
        Date.now() - startedAt,
      );
      const buySignals = await this.prisma.strategySignal.findMany({
        where: { backtestRunId: run.id, signalType: "BUY" },
        select: { id: true },
      });
      for (const signal of buySignals) await this.signals.review(signal.id);
      return this.get(run.id);
    } catch (error: unknown) {
      await this.prisma.backtestRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          runDurationMs: Date.now() - startedAt,
          errorMessage: error instanceof Error ? error.message : "量化计算失败",
        },
      });
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : "回测失败");
    }
  }

  async get(id: string) {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id },
      include: {
        strategy: true,
        equityPoints: { orderBy: { tradeDate: "asc" } },
        trades: { orderBy: { executionTime: "asc" } },
        positions: true,
        signals: { orderBy: { signalTime: "asc" } },
      },
    });
    if (!run) throw new NotFoundException("回测任务不存在");
    const marketData = await this.prisma.marketDataDaily.findMany({
      where: {
        symbol: run.symbol,
        source: run.marketDataSource,
        tradeDate: { gte: run.marketDataStart, lte: run.marketDataEnd },
      },
      select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
      orderBy: { tradeDate: "asc" },
      take: MAX_BACKTEST_BARS,
    });
    return {
      ...this.serializeRun(run),
      strategy: {
        ...run.strategy,
        parameters: JSON.parse(run.strategy.parameters),
        symbolUniverse: JSON.parse(run.strategy.symbolUniverse),
      },
      equityPoints: run.equityPoints.map((point) => ({
        tradeDate: point.tradeDate.toISOString().slice(0, 10),
        equity: toNumber(point.equity),
        cash: toNumber(point.cash),
        positionValue: toNumber(point.positionValue),
        drawdown: toNumber(point.drawdown),
        benchmarkEquity: toNumber(point.benchmarkEquity),
      })),
      trades: run.trades.map((trade) => ({
        ...trade,
        executionPrice: toNumber(trade.executionPrice),
        quantity: toNumber(trade.quantity),
        notional: toNumber(trade.notional),
        commission: toNumber(trade.commission),
        slippage: toNumber(trade.slippage),
        realizedPnl: trade.realizedPnl ? toNumber(trade.realizedPnl) : null,
      })),
      positions: run.positions.map((position) => ({
        ...position,
        quantity: toNumber(position.quantity),
        avgCost: toNumber(position.avgCost),
        lastPrice: toNumber(position.lastPrice),
        marketValue: toNumber(position.marketValue),
        unrealizedPnl: toNumber(position.unrealizedPnl),
      })),
      signals: run.signals.map((signal) => ({
        ...signal,
        referencePrice: signal.referencePrice ? toNumber(signal.referencePrice) : null,
        requestedAmount: signal.requestedAmount ? toNumber(signal.requestedAmount) : null,
        riskResult: signal.riskResultJson ? JSON.parse(signal.riskResultJson) : null,
      })),
      marketData: marketData.map((bar) => ({
        tradeDate: bar.tradeDate.toISOString().slice(0, 10),
        open: toNumber(bar.open),
        high: toNumber(bar.high),
        low: toNumber(bar.low),
        close: toNumber(bar.close),
        volume: toNumber(bar.volume),
      })),
    };
  }

  async cancel(id: string) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException("回测任务不存在");
    if (!["PENDING", "RUNNING"].includes(run.status)) {
      throw new BadRequestException("只有等待或运行中的任务可以取消");
    }
    return this.prisma.backtestRun.update({
      where: { id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
  }

  async exportTrades(id: string) {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id },
      include: { trades: { orderBy: { executionTime: "asc" } } },
    });
    if (!run) throw new NotFoundException("回测任务不存在");
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = [
      "symbol",
      "side",
      "signalTime",
      "orderTime",
      "executionTime",
      "executionPrice",
      "quantity",
      "notional",
      "commission",
      "slippage",
      "realizedPnl",
      "holdingDays",
      "triggerReason",
    ];
    return [
      header.join(","),
      ...run.trades.map((trade) =>
        [
          trade.symbol,
          trade.side,
          trade.signalTime.toISOString(),
          trade.orderTime.toISOString(),
          trade.executionTime.toISOString(),
          trade.executionPrice,
          trade.quantity,
          trade.notional,
          trade.commission,
          trade.slippage,
          trade.realizedPnl ?? "",
          trade.holdingDays ?? "",
          trade.triggerReason,
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\r\n");
  }

  private async persistResult(
    runId: string,
    strategyId: string,
    accountId: string | null,
    result: QuantBacktestResult,
    runDurationMs: number,
  ) {
    await this.prisma.$transaction(
      async (transaction) => {
        for (let index = 0; index < result.equityPoints.length; index += 100) {
          await transaction.backtestEquityPoint.createMany({
            data: result.equityPoints.slice(index, index + 100).map((point) => ({
              backtestRunId: runId,
              tradeDate: this.utcDate(point.tradeDate),
              equity: point.equity,
              cash: point.cash,
              positionValue: point.positionValue,
              drawdown: point.drawdown,
              benchmarkEquity: point.benchmarkEquity,
            })),
          });
        }
        if (result.trades.length > 0) {
          await transaction.backtestTrade.createMany({
            data: result.trades.map((trade) => ({
              backtestRunId: runId,
              symbol: trade.symbol,
              side: trade.side,
              signalTime: this.utcDate(trade.signalTime),
              orderTime: this.utcDate(trade.orderTime),
              executionTime: this.utcDate(trade.executionTime),
              executionPrice: trade.executionPrice,
              quantity: trade.quantity,
              notional: trade.notional,
              commission: trade.commission,
              slippage: trade.slippage,
              realizedPnl: trade.realizedPnl,
              holdingDays: trade.holdingDays,
              triggerReason: trade.triggerReason,
            })),
          });
        }
        if (result.positions.length > 0) {
          await transaction.backtestPosition.createMany({
            data: result.positions.map((position) => ({
              backtestRunId: runId,
              ...position,
            })),
          });
        }
        if (result.signals.length > 0) {
          await transaction.strategySignal.createMany({
            data: result.signals.map((signal) => ({
              strategyId,
              backtestRunId: runId,
              accountId,
              symbol: signal.symbol,
              signalType: signal.side,
              signalTime: this.utcDate(signal.signalTime),
              requestedAmount: signal.requestedAmount,
              referencePrice: signal.referencePrice,
              stopLossCondition: signal.stopLossCondition,
              exitCondition: signal.exitCondition,
              triggerReason: signal.reason,
              status: "GENERATED",
            })),
          });
        }
        await transaction.backtestRun.update({
          where: { id: runId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            runDurationMs,
            quantEngineVersion: result.engineVersion,
            finalEquity: result.metrics.finalEquity,
            totalReturn: result.metrics.totalReturn,
            maxDrawdown: result.metrics.maxDrawdown,
            sharpeRatio: result.metrics.sharpeRatio,
            benchmarkReturn: result.metrics.benchmarkReturn,
            totalCommission: result.metrics.totalCommission,
            tradeCount: result.metrics.totalTrades,
            metricsJson: JSON.stringify(result.metrics),
            monthlyReturnsJson: JSON.stringify(result.monthlyReturns),
            riskNotice: result.riskNotice,
          },
        });
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private serializeRun<T extends Prisma.BacktestRunGetPayload<Record<string, never>>>(run: T) {
    return {
      ...run,
      initialCapital: toNumber(run.initialCapital),
      commissionRate: toNumber(run.commissionRate),
      slippageRate: toNumber(run.slippageRate),
      finalEquity: run.finalEquity ? toNumber(run.finalEquity) : null,
      totalReturn: run.totalReturn ? toNumber(run.totalReturn) : null,
      maxDrawdown: run.maxDrawdown ? toNumber(run.maxDrawdown) : null,
      sharpeRatio: run.sharpeRatio ? toNumber(run.sharpeRatio) : null,
      benchmarkReturn: run.benchmarkReturn ? toNumber(run.benchmarkReturn) : null,
      totalCommission: run.totalCommission ? toNumber(run.totalCommission) : null,
      parameters: JSON.parse(run.parameterSnapshot),
      metrics: run.metricsJson ? JSON.parse(run.metricsJson) : null,
      monthlyReturns: run.monthlyReturnsJson ? JSON.parse(run.monthlyReturnsJson) : [],
    };
  }

  private warmupCount(strategyType: string, parameters: Record<string, unknown>) {
    if (strategyType === "MultiHorizonTrend") {
      const horizons = parameters.lookbackDays;
      if (
        !Array.isArray(horizons) ||
        horizons.length < 2 ||
        horizons.some(
          (item) => !Number.isInteger(Number(item)) || Number(item) < 20 || Number(item) > 504,
        )
      ) {
        throw new BadRequestException(
          "MultiHorizonTrend.lookbackDays 必须包含至少两个 20 到 504 的整数",
        );
      }
      return Math.max(...horizons.map(Number));
    }
    if (
      !["TimeSeriesMomentum", "DualMomentumRotation", "CoreSatelliteMomentum"].includes(
        strategyType,
      )
    )
      return 0;
    const lookbackDays = Number(
      parameters.lookbackDays ?? (strategyType === "TimeSeriesMomentum" ? 120 : 252),
    );
    if (!Number.isInteger(lookbackDays) || lookbackDays < 20 || lookbackDays > 504) {
      throw new BadRequestException(`${strategyType}.lookbackDays 必须是 20 到 504 的整数`);
    }
    return lookbackDays;
  }

  private backtestSymbols(
    strategyType: string,
    parameters: Record<string, unknown>,
    primarySymbol: string,
  ) {
    const symbol = (value: unknown, field: string) => {
      if (typeof value !== "string" || !/^[A-Z0-9.-]{1,32}$/.test(value)) {
        throw new BadRequestException(`${strategyType}.${field} 必须是大写证券代码`);
      }
      return value;
    };
    const symbols = (value: unknown, field: string, minimum: number) => {
      if (!Array.isArray(value) || value.length < minimum || value.length > 20) {
        throw new BadRequestException(`${strategyType}.${field} 标的数量无效`);
      }
      const values = value.map((item) => symbol(item, field));
      if (new Set(values).size !== values.length) {
        throw new BadRequestException(`${strategyType}.${field} 不能包含重复标的`);
      }
      return values;
    };
    if (strategyType === "MultiHorizonTrend") {
      const configured = symbol(parameters.symbol ?? primarySymbol, "symbol");
      if (configured !== primarySymbol)
        throw new BadRequestException("多周期趋势的回测标的必须与参数 symbol 一致");
      return [configured];
    }
    if (strategyType === "DualMomentumRotation") {
      const benchmark = symbol(parameters.benchmarkSymbol ?? primarySymbol, "benchmarkSymbol");
      if (benchmark !== primarySymbol)
        throw new BadRequestException("多资产回测 symbol 必须等于 benchmarkSymbol");
      return [
        ...new Set([
          ...symbols(parameters.riskAssets, "riskAssets", 2),
          symbol(parameters.defensiveAsset, "defensiveAsset"),
          benchmark,
        ]),
      ];
    }
    if (strategyType === "CoreSatelliteMomentum") {
      const benchmark = symbol(parameters.benchmarkSymbol ?? primarySymbol, "benchmarkSymbol");
      if (benchmark !== primarySymbol)
        throw new BadRequestException("多资产回测 symbol 必须等于 benchmarkSymbol");
      return [
        ...new Set([
          symbol(parameters.coreSymbol, "coreSymbol"),
          ...symbols(parameters.satelliteAssets, "satelliteAssets", 1),
          symbol(parameters.defensiveAsset, "defensiveAsset"),
          benchmark,
        ]),
      ];
    }
    return [primarySymbol];
  }

  private utcDate(input: string) {
    const date = new Date(`${input.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return date;
  }
}
