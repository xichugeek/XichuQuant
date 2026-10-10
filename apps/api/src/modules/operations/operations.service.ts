import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { MarketDataSyncService } from "../market-data/market-data-sync.service";
import { BrokerSyncService } from "../broker-sync/broker-sync.service";
import { UsMarketCalendarService } from "../market-data/us-market-calendar.service";
import { PaperTradingService } from "../paper-trading/paper-trading.service";
import { PortfolioService } from "../portfolios/portfolio.service";
import type { RunDailyCycleDto } from "./operations.dto";
import {
  dailyCycleKey,
  observationIsEligible,
  qualityAllowsStrategy,
  taskCanRetry,
} from "./operations.rules";

type JsonObject = Record<string, unknown>;

@Injectable()
export class OperationsService implements OnModuleInit {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: UsMarketCalendarService,
    private readonly marketDataSync: MarketDataSyncService,
    private readonly paperTrading: PaperTradingService,
    private readonly portfolios: PortfolioService,
    private readonly brokerSync: BrokerSyncService,
  ) {}

  async onModuleInit() {
    if (process.env.PUBLIC_DEMO_READ_ONLY === "true") return;
    const interrupted = await this.prisma.systemTask.updateMany({
      where: { status: { in: ["RUNNING", "RETRYING"] } },
      data: {
        completedAt: new Date(),
        errorMessage: "服务重启中断任务；原幂等键已保留，可从任务中心安全重试",
        status: "FAILED",
      },
    });
    if (interrupted.count > 0) {
      this.logger.warn(`Recovered ${interrupted.count} interrupted V1.5 task(s)`);
      await this.notify(
        "TASK_RECOVERY_REQUIRED",
        "WARNING",
        "服务重启后发现中断任务",
        `${interrupted.count} 个任务已安全停止，请在任务中心使用原幂等键重试。`,
        null,
        "TASK_RECOVERY_REQUIRED",
      );
    }
  }

  @Cron("0 20 22 * * 1-5", { timeZone: "America/New_York" })
  async scheduledDailyCycle() {
    if (process.env.PUBLIC_DEMO_READ_ONLY === "true") return;
    try {
      await this.runDailyCycle({});
    } catch (error: unknown) {
      this.logger.error({ error }, "V1.5 daily cycle failed safely");
    }
  }

  marketClock() {
    return this.calendar.marketClock();
  }

  async runDailyCycle(dto: RunDailyCycleDto) {
    const session = dto.marketDate
      ? this.calendar.session(dto.marketDate)
      : this.calendar.latestCompletedSession();
    await this.persistCalendarSession(session);
    const provider = await this.resolveProvider(dto.providerCode);
    const idempotencyKey = dailyCycleKey(session.date, provider.code);
    const existing = await this.prisma.systemTask.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "COMPLETED" || existing?.status === "SKIPPED") {
      return { ...this.serializeTask(existing), idempotent: true };
    }
    const acquisition = await this.startTask("DAILY_CYCLE", idempotencyKey, session.date, {
      marketDate: session.date,
      providerCode: provider.code,
      timeZone: session.timeZone,
    });
    if (!acquisition.acquired) {
      return {
        ...this.serializeTask(acquisition.task),
        idempotent: true,
        inProgress: ["PENDING", "RUNNING", "RETRYING"].includes(acquisition.task.status),
      };
    }
    const task = acquisition.task;
    if (!session.isTradingDay) {
      return this.finishTask(task.id, "SKIPPED", {
        holidayName: session.holidayName,
        reason: "NON_TRADING_DAY",
      });
    }
    try {
      const control = await this.paperTrading.controlState();
      if (control.killSwitchEnabled) {
        await this.notify(
          "KILL_SWITCH",
          "CRITICAL",
          "Kill Switch 已启用",
          "自动行情同步可以继续审计，但策略运行和新模拟订单已被阻止。",
          task.id,
          `KILL_SWITCH:${session.date}`,
        );
        return this.finishTask(task.id, "SKIPPED", { reason: "KILL_SWITCH_ENABLED" });
      }
      const deployments = await this.prisma.strategyDeployment.findMany({
        where: { status: "PAPER_RUNNING" },
        select: { id: true, symbolUniverseJson: true },
      });
      const symbols = [
        ...new Set(
          deployments.flatMap(
            (deployment) => JSON.parse(deployment.symbolUniverseJson) as string[],
          ),
        ),
      ];
      if (symbols.length === 0) {
        return this.finishTask(task.id, "COMPLETED", {
          message: "没有运行中的模拟策略",
          symbols: [],
        });
      }

      const sync = await this.childTask(
        task.id,
        "MARKET_DATA_SYNC",
        `MARKET_DATA_SYNC:${session.date}:${provider.code}`,
        session.date,
        { providerCode: provider.code, symbols },
        () => this.marketDataSync.sync(provider.code, symbols, session.date),
      );
      const quality = await this.childTask(
        task.id,
        "DATA_QUALITY_GATE",
        `DATA_QUALITY_GATE:${session.date}:${provider.code}`,
        session.date,
        { providerCode: provider.code, symbols },
        () => this.refreshDataQuality(session.date, provider.code, symbols),
      );
      const reports = quality.result as Array<{
        allowStrategyRun: boolean;
        issues: string[];
        symbol: string;
      }>;
      const blocked = reports.filter((report) => !report.allowStrategyRun);
      if (blocked.length > 0) {
        await this.notify(
          "DATA_QUALITY_BLOCKED",
          "CRITICAL",
          "行情数据质量阻止策略运行",
          blocked.map((item) => `${item.symbol}: ${item.issues.join("；")}`).join(" | "),
          task.id,
          `DATA_QUALITY_BLOCKED:${session.date}:${provider.code}`,
        );
        return this.finishTask(task.id, "SKIPPED", {
          blocked,
          quality: reports,
          reason: "DATA_QUALITY_BLOCKED",
          sync,
        });
      }

      const brokerSafety = await this.brokerSync.safetyState();
      if (brokerSafety.safetyState === "LOCKDOWN") {
        await this.notify(
          "BROKER_LOCKDOWN",
          "CRITICAL",
          "全局安全状态阻止自动策略",
          "行情只读同步与质量检查已完成；模拟策略、组合和影子交易均未运行。",
          task.id,
          `BROKER_LOCKDOWN:${session.date}`,
        );
        return this.finishTask(task.id, "SKIPPED", {
          quality: reports,
          reason: "BROKER_LOCKDOWN",
          sync,
        });
      }

      const fills = await this.childTask(
        task.id,
        "PAPER_ORDER_EXECUTION",
        `PAPER_ORDER_EXECUTION:${session.date}`,
        session.date,
        { marketDate: session.date },
        () => this.paperTrading.processPendingOrders(),
      );
      const portfolioFills = await this.childTask(
        task.id,
        "PORTFOLIO_ORDER_EXECUTION",
        `PORTFOLIO_ORDER_EXECUTION:${session.date}`,
        session.date,
        { marketDate: session.date },
        () => this.portfolios.processPendingOrders(),
      );
      const executions = [];
      for (const deployment of deployments) {
        executions.push(
          await this.childTask(
            task.id,
            "STRATEGY_EXECUTION",
            `STRATEGY_EXECUTION:${deployment.id}:${session.date}`,
            session.date,
            { deploymentId: deployment.id, marketDate: session.date },
            () => this.paperTrading.runDeployment(deployment.id, { signalTradeDate: session.date }),
          ),
        );
      }
      const runningPortfolios = await this.prisma.strategyPortfolio.findMany({
        where: { status: "PAPER_RUNNING" },
        select: { id: true, rebalanceMode: true },
      });
      const portfolioExecutions = [];
      for (const portfolio of runningPortfolios) {
        const decision = await this.portfolios.autoRebalanceDecision(portfolio.id);
        if (!decision.run) {
          portfolioExecutions.push({
            portfolioId: portfolio.id,
            reason: decision.reason,
            skipped: true,
          });
          continue;
        }
        portfolioExecutions.push(
          await this.childTask(
            task.id,
            "PORTFOLIO_EXECUTION",
            `PORTFOLIO_EXECUTION:${portfolio.id}:${session.date}`,
            session.date,
            { portfolioId: portfolio.id, marketDate: session.date },
            () =>
              this.portfolios.previewOrExecute(portfolio.id, {
                execute: true,
                runType: portfolio.rebalanceMode as
                  "MANUAL" | "RISK_TRIGGERED" | "SCHEDULED" | "THRESHOLD",
                tradeDate: session.date,
              }),
          ),
        );
      }
      const snapshots = await this.childTask(
        task.id,
        "EQUITY_SNAPSHOT",
        `EQUITY_SNAPSHOT:${session.date}`,
        session.date,
        { snapshotTime: session.sessionCloseUtc?.toISOString() },
        () =>
          this.paperTrading.refreshEquitySnapshots(
            session.sessionCloseUtc ?? new Date(`${session.date}T21:00:00.000Z`),
          ),
      );
      const observation = await this.childTask(
        task.id,
        "FORWARD_OBSERVATION",
        `FORWARD_OBSERVATION:${session.date}`,
        session.date,
        { marketDate: session.date },
        () => this.refreshForwardObservations(session.date),
      );
      const portfolioSnapshots = [];
      for (const portfolio of runningPortfolios) {
        portfolioSnapshots.push(
          await this.childTask(
            task.id,
            "PORTFOLIO_SNAPSHOT",
            `PORTFOLIO_SNAPSHOT:${portfolio.id}:${session.date}`,
            session.date,
            { portfolioId: portfolio.id, marketDate: session.date },
            () => this.portfolios.refreshSnapshot(portfolio.id, session.date),
          ),
        );
      }
      return this.finishTask(task.id, "COMPLETED", {
        executions,
        fills,
        observation,
        portfolioExecutions,
        portfolioFills,
        portfolioSnapshots,
        quality: reports,
        snapshots,
        sync,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "每日任务执行失败";
      await this.failTask(task.id, message);
      const failure = message.includes("量化")
        ? { title: "Quant Engine 离线，策略运行已停止", type: "QUANT_ENGINE_OFFLINE" }
        : message.includes("Provider") || message.includes("行情")
          ? { title: "行情同步失败，策略运行已停止", type: "MARKET_DATA_SYNC_FAILED" }
          : { title: "每日自动任务失败", type: "DAILY_CYCLE_FAILED" };
      await this.notify(
        failure.type,
        "CRITICAL",
        failure.title,
        message,
        task.id,
        `${failure.type}:${session.date}`,
      );
      throw new BadRequestException(`每日任务安全失败：${message}`);
    }
  }

  async calendarRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) throw new BadRequestException("必须提供 startDate 和 endDate");
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new BadRequestException("交易日历日期范围无效");
    }
    const sessions = [];
    for (
      const cursor = new Date(start);
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const session = this.calendar.session(cursor.toISOString().slice(0, 10));
      await this.persistCalendarSession(session);
      sessions.push(session);
    }
    return sessions;
  }

  async refreshDataQuality(
    requestedDate?: string,
    providerCode?: string,
    explicitSymbols?: string[],
  ) {
    const session = requestedDate
      ? this.calendar.session(requestedDate)
      : this.calendar.latestCompletedSession();
    if (!session.isTradingDay) throw new BadRequestException(`${session.date} 不是完整交易日`);
    const provider = await this.resolveProvider(providerCode);
    const symbols = explicitSymbols?.length
      ? explicitSymbols
      : await this.activeSymbols(provider.code);
    const tradingDays = this.calendar
      .tradingDays(this.addDays(session.date, -45), session.date)
      .slice(-30);
    const startDate = tradingDays[0]?.date ?? session.date;
    const reports = [];
    for (const symbol of symbols) {
      const rows = await this.prisma.marketDataDaily.findMany({
        where: {
          providerId: provider.id,
          source: provider.code,
          symbol,
          tradeDate: {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lte: new Date(`${session.date}T00:00:00.000Z`),
          },
        },
        orderBy: { tradeDate: "asc" },
      });
      const rowDates = new Set(rows.map((row) => row.tradeDate.toISOString().slice(0, 10)));
      const missingDays = tradingDays
        .filter((day) => !rowDates.has(day.date))
        .map((day) => day.date);
      const invalidOhlcCount = rows.filter((row) => {
        const open = toNumber(row.open);
        const high = toNumber(row.high);
        const low = toNumber(row.low);
        const close = toNumber(row.close);
        return (
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0 ||
          high < low ||
          open < low ||
          open > high ||
          close < low ||
          close > high
        );
      }).length;
      const zeroVolumeCount = rows.filter((row) => toNumber(row.volume) === 0).length;
      const splitEventCount = rows.filter((row) => toNumber(row.splitFactor) !== 1).length;
      const dividendEventCount = rows.filter((row) => toNumber(row.dividend) > 0).length;
      const latestTradeDate = rows.at(-1)?.tradeDate ?? null;
      const issues = [
        ...(latestTradeDate?.toISOString().slice(0, 10) !== session.date
          ? ["最新完整交易日行情缺失"]
          : []),
        ...(missingDays.length > 0 ? [`最近窗口缺失 ${missingDays.length} 个交易日`] : []),
        ...(invalidOhlcCount > 0 ? [`存在 ${invalidOhlcCount} 条异常 OHLC`] : []),
        ...(zeroVolumeCount > 0 ? [`存在 ${zeroVolumeCount} 条零成交量记录`] : []),
      ];
      const allowStrategyRun = qualityAllowsStrategy({
        invalidOhlcCount,
        latestComplete: latestTradeDate?.toISOString().slice(0, 10) === session.date,
        missingDayCount: missingDays.length,
        zeroVolumeCount,
      });
      const report = await this.prisma.dataQualityReport.upsert({
        where: {
          providerId_symbol_analysisDate: {
            providerId: provider.id,
            symbol,
            analysisDate: new Date(`${session.date}T00:00:00.000Z`),
          },
        },
        update: {
          allowStrategyRun,
          dividendEventCount,
          invalidOhlcCount,
          issuesJson: JSON.stringify({ issues, missingDays }),
          latestTradeDate,
          missingDayCount: missingDays.length,
          splitEventCount,
          status: allowStrategyRun ? "PASSED" : "BLOCKED",
          zeroVolumeCount,
        },
        create: {
          providerId: provider.id,
          symbol,
          analysisDate: new Date(`${session.date}T00:00:00.000Z`),
          allowStrategyRun,
          dividendEventCount,
          duplicateCount: 0,
          invalidOhlcCount,
          issuesJson: JSON.stringify({ issues, missingDays }),
          latestTradeDate,
          missingDayCount: missingDays.length,
          splitEventCount,
          status: allowStrategyRun ? "PASSED" : "BLOCKED",
          zeroVolumeCount,
        },
      });
      reports.push({ ...report, issues, missingDays });
    }
    return reports;
  }

  async dataQualityDashboard() {
    const [reports, providers, syncJobs] = await Promise.all([
      this.prisma.dataQualityReport.findMany({
        include: { provider: true },
        orderBy: [{ analysisDate: "desc" }, { symbol: "asc" }],
        take: 200,
      }),
      this.marketDataSync.providerStatus(),
      this.prisma.marketDataSyncJob.findMany({
        include: { provider: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);
    return {
      providers,
      reports: reports.map((report) => ({ ...report, issues: JSON.parse(report.issuesJson) })),
      syncJobs,
      safeguards: {
        dataQualityGate: true,
        partialWrites: false,
        serverLocalDateUsed: false,
        timeZone: "America/New_York",
      },
    };
  }

  async tasks(status?: string, taskType?: string) {
    const rows = await this.prisma.systemTask.findMany({
      where: { status: status || undefined, taskType: taskType || undefined },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return rows.map((task) => this.serializeTask(task));
  }

  async retryTask(id: string) {
    const task = await this.prisma.systemTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("任务不存在");
    if (!taskCanRetry(task.status, task.attemptCount, task.maxAttempts))
      throw new BadRequestException("任务状态或重试次数不允许继续重试");
    const input = task.inputJson ? (JSON.parse(task.inputJson) as RunDailyCycleDto) : {};
    if (task.taskType === "DAILY_CYCLE") return this.runDailyCycle(input);
    const parent = task.parentTaskId
      ? await this.prisma.systemTask.findUnique({ where: { id: task.parentTaskId } })
      : null;
    if (!parent?.inputJson) throw new BadRequestException("子任务缺少可恢复的父任务上下文");
    return this.runDailyCycle(JSON.parse(parent.inputJson) as RunDailyCycleDto);
  }

  async notifications(status?: string) {
    const rows = await this.prisma.systemNotification.findMany({
      where: { status: status || undefined },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return rows.map((item) => ({
      ...item,
      metadata: item.metadataJson ? JSON.parse(item.metadataJson) : null,
    }));
  }

  async markNotificationRead(id?: string) {
    const now = new Date();
    if (id)
      return this.prisma.systemNotification.update({
        where: { id },
        data: { readAt: now, status: "READ" },
      });
    const result = await this.prisma.systemNotification.updateMany({
      where: { status: "UNREAD" },
      data: { readAt: now, status: "READ" },
    });
    return { updated: result.count };
  }

  async refreshForwardObservations(requestedDate?: string) {
    const session = requestedDate
      ? this.calendar.session(requestedDate)
      : this.calendar.latestCompletedSession();
    const deployments = await this.prisma.strategyDeployment.findMany({
      where: { status: { in: ["PAPER_RUNNING", "PAPER_PAUSED", "PAPER_STOPPED"] } },
      include: {
        executionRuns: true,
        orders: { include: { fills: true } },
        paperAccount: true,
        positions: true,
        riskDecisions: true,
        strategy: {
          include: {
            backtestRuns: {
              where: { status: "COMPLETED" },
              orderBy: { completedAt: "desc" },
              take: 1,
            },
            validationRuns: {
              where: { status: "COMPLETED" },
              orderBy: { completedAt: "desc" },
              take: 1,
              include: { windows: true },
            },
          },
        },
      },
    });
    const snapshots = [];
    for (const deployment of deployments) {
      const startAt =
        deployment.observationStartedAt ?? deployment.startedAt ?? deployment.createdAt;
      const startDate = startAt.toISOString().slice(0, 10);
      const universe = JSON.parse(deployment.symbolUniverseJson) as string[];
      const symbol = universe[0] ?? "";
      const [firstBar, lastBar, taskSkips] = await Promise.all([
        this.prisma.marketDataDaily.findFirst({
          where: { symbol, tradeDate: { gte: new Date(`${startDate}T00:00:00.000Z`) } },
          orderBy: { tradeDate: "asc" },
        }),
        this.prisma.marketDataDaily.findFirst({
          where: { symbol, tradeDate: { lte: new Date(`${session.date}T23:59:59.999Z`) } },
          orderBy: { tradeDate: "desc" },
        }),
        this.prisma.systemTask.findMany({
          where: { inputJson: { contains: deployment.id }, status: { in: ["SKIPPED", "FAILED"] } },
          select: { status: true, taskType: true },
        }),
      ]);
      const fills = deployment.orders.flatMap((order) => order.fills);
      const actualSlippage = fills.reduce((sum, fill) => sum + toNumber(fill.slippage), 0);
      const totalCommission = fills.reduce((sum, fill) => sum + toNumber(fill.commission), 0);
      const actualPnl =
        deployment.positions.reduce(
          (sum, position) =>
            sum + toNumber(position.realizedPnl) + toNumber(position.unrealizedPnl),
          0,
        ) + fills.reduce((sum, fill) => sum + toNumber(fill.realizedPnl), 0);
      const actualReturn =
        toNumber(deployment.capitalAllocation) > 0
          ? (actualPnl / toNumber(deployment.capitalAllocation)) * 100
          : 0;
      const theoreticalReturn =
        firstBar && lastBar
          ? (toNumber(lastBar.adjustedClose) / toNumber(firstBar.adjustedClose) - 1) * 100
          : 0;
      const returnDeviation = actualReturn - theoreticalReturn;
      const runningTradingDays = this.calendar.tradingDays(startDate, session.date).length;
      const signalCount = new Set(
        deployment.executionRuns.map((run) => run.strategySignalId).filter(Boolean),
      ).size;
      const riskRejectedCount = deployment.riskDecisions.filter(
        (decision) => decision.decision === "RISK_REJECTED",
      ).length;
      const dataSkippedCount = taskSkips.filter(
        (task) => task.taskType === "DATA_QUALITY_GATE",
      ).length;
      const serviceSkippedCount = taskSkips.filter(
        (task) => task.taskType !== "DATA_QUALITY_GATE",
      ).length;
      const backtest = deployment.strategy.backtestRuns[0];
      const validation = deployment.strategy.validationRuns[0];
      const validationMetrics = validation?.outSampleMetricsJson
        ? JSON.parse(validation.outSampleMetricsJson)
        : null;
      const walkForward =
        validation?.windows.map((window) => ({
          end: window.testEnd,
          return: window.totalReturn,
          start: window.testStart,
        })) ?? [];
      const riskConfig = JSON.parse(deployment.paperRiskConfigJson) as {
        maxDrawdownPercent?: number;
      };
      const observationEligible = observationIsEligible({
        eventCount: signalCount + fills.length,
        maxDrawdown: toNumber(deployment.paperAccount.maxDrawdown),
        maxDrawdownLimit: riskConfig.maxDrawdownPercent ?? 20,
        requiredTradingDays: deployment.observationRequiredDays,
        returnDeviation,
        riskRejectedCount,
        runningTradingDays,
      });
      const comparison = {
        forward: {
          actualReturn,
          actualSlippage,
          fillCount: fills.length,
          runningTradingDays,
          signalCount,
          totalCommission,
        },
        historicalBacktest: backtest
          ? {
              maxDrawdown: toNumber(backtest.maxDrawdown),
              totalReturn: toNumber(backtest.totalReturn),
            }
          : null,
        observationEligible,
        outOfSample: validationMetrics,
        walkForward,
      };
      const snapshot = await this.prisma.forwardObservationSnapshot.upsert({
        where: {
          strategyDeploymentId_observationDate: {
            strategyDeploymentId: deployment.id,
            observationDate: new Date(`${session.date}T00:00:00.000Z`),
          },
        },
        update: {
          actualReturn,
          actualSlippage,
          comparisonJson: JSON.stringify(comparison),
          consecutiveLosses: deployment.consecutiveLosses,
          dataSkippedCount,
          fillCount: fills.length,
          maxDrawdown: deployment.paperAccount.maxDrawdown,
          returnDeviation,
          riskRejectedCount,
          runningTradingDays,
          serviceSkippedCount,
          signalCount,
          theoreticalReturn,
          totalCommission,
        },
        create: {
          strategyDeploymentId: deployment.id,
          observationDate: new Date(`${session.date}T00:00:00.000Z`),
          actualReturn,
          actualSlippage,
          comparisonJson: JSON.stringify(comparison),
          consecutiveLosses: deployment.consecutiveLosses,
          dataSkippedCount,
          fillCount: fills.length,
          maxDrawdown: deployment.paperAccount.maxDrawdown,
          returnDeviation,
          riskRejectedCount,
          runningTradingDays,
          serviceSkippedCount,
          signalCount,
          theoreticalReturn,
          totalCommission,
        },
      });
      if (
        !deployment.observationStartedAt ||
        deployment.strategy.approvalStatus === "PAPER_RUNNING"
      ) {
        await this.prisma.$transaction([
          this.prisma.strategyDeployment.update({
            where: { id: deployment.id },
            data: { observationStartedAt: deployment.observationStartedAt ?? startAt },
          }),
          this.prisma.strategy.update({
            where: { id: deployment.strategyId },
            data: { approvalStatus: "PAPER_OBSERVING" },
          }),
        ]);
      }
      if (Math.abs(returnDeviation) > 10) {
        await this.notify(
          "FORWARD_DEVIATION",
          "WARNING",
          "模拟表现明显偏离回测",
          "模拟交易结果明显弱于历史回测，请检查滑点、行情质量、策略失效或过拟合风险。",
          null,
          `FORWARD_DEVIATION:${deployment.id}:${session.date}`,
        );
      }
      if (deployment.consecutiveLosses >= 3) {
        await this.notify(
          "CONSECUTIVE_LOSSES",
          "WARNING",
          "模拟策略连续亏损",
          `${deployment.name} 已连续亏损 ${deployment.consecutiveLosses} 次，请检查策略是否失效。`,
          null,
          `CONSECUTIVE_LOSSES:${deployment.id}:${deployment.consecutiveLosses}`,
        );
      }
      if (
        Math.abs(toNumber(deployment.paperAccount.maxDrawdown)) >
        (riskConfig.maxDrawdownPercent ?? 20)
      ) {
        await this.notify(
          "PAPER_DRAWDOWN_LIMIT",
          "CRITICAL",
          "模拟账户回撤超过上限",
          `${deployment.name} 当前最大回撤 ${toNumber(deployment.paperAccount.maxDrawdown).toFixed(2)}%。`,
          null,
          `PAPER_DRAWDOWN:${deployment.id}:${session.date}`,
        );
      }
      snapshots.push({ ...snapshot, comparison });
    }
    return snapshots;
  }

  async forwardObservationDashboard() {
    const deployments = await this.prisma.strategyDeployment.findMany({
      include: {
        forwardObservations: { orderBy: { observationDate: "asc" } },
        strategy: { select: { approvalStatus: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return deployments.map((deployment) => ({
      deployment: {
        id: deployment.id,
        name: deployment.name,
        observationRequiredDays: deployment.observationRequiredDays,
        observationStartedAt: deployment.observationStartedAt,
        status: deployment.status,
        strategy: deployment.strategy,
      },
      latest: deployment.forwardObservations.at(-1)
        ? this.serializeObservation(deployment.forwardObservations.at(-1)!)
        : null,
      history: deployment.forwardObservations.map((snapshot) =>
        this.serializeObservation(snapshot),
      ),
      boundaries: { autoLivePromotion: false, brokerOrders: false, separateFromBacktest: true },
    }));
  }

  private async activeSymbols(providerCode: string) {
    const deployments = await this.prisma.strategyDeployment.findMany({
      where: { status: "PAPER_RUNNING" },
      select: { symbolUniverseJson: true },
    });
    const symbols = [
      ...new Set(deployments.flatMap((item) => JSON.parse(item.symbolUniverseJson) as string[])),
    ];
    if (symbols.length > 0) return symbols;
    const rows = await this.prisma.marketDataDaily.findMany({
      where: { source: providerCode },
      distinct: ["symbol"],
      select: { symbol: true },
    });
    return rows.map((row) => row.symbol);
  }

  private async resolveProvider(providerCode?: string) {
    const provider = providerCode
      ? await this.prisma.marketDataProvider.findUnique({ where: { code: providerCode } })
      : await this.prisma.marketDataProvider.findFirst({
          where: { enabled: true, providerType: { in: ["HTTP_JSON", "SEED"] } },
          orderBy: [{ providerType: "asc" }, { code: "asc" }],
        });
    if (!provider) throw new BadRequestException("没有启用的自动行情 Provider");
    return provider;
  }

  private async startTask(
    taskType: string,
    idempotencyKey: string,
    marketDate: string,
    input: JsonObject,
    parentTaskId?: string,
  ) {
    const existing = await this.prisma.systemTask.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (!taskCanRetry(existing.status, existing.attemptCount, existing.maxAttempts)) {
        return { acquired: false, task: existing };
      }
      const task = await this.prisma.systemTask.update({
        where: { id: existing.id },
        data: {
          attemptCount: { increment: 1 },
          completedAt: null,
          errorMessage: null,
          inputJson: JSON.stringify(input),
          parentTaskId,
          startedAt: new Date(),
          status: "RETRYING",
        },
      });
      return { acquired: true, task };
    }
    try {
      const task = await this.prisma.systemTask.create({
        data: {
          attemptCount: 1,
          idempotencyKey,
          inputJson: JSON.stringify(input),
          marketDate: new Date(`${marketDate}T00:00:00.000Z`),
          parentTaskId,
          scheduledFor: new Date(),
          startedAt: new Date(),
          status: "RUNNING",
          taskType,
        },
      });
      return { acquired: true, task };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.prisma.systemTask.findUnique({ where: { idempotencyKey } });
        if (duplicate) return { acquired: false, task: duplicate };
      }
      throw error;
    }
  }

  private async childTask(
    parentTaskId: string,
    taskType: string,
    key: string,
    marketDate: string,
    input: JsonObject,
    run: () => Promise<unknown>,
  ) {
    const existing = await this.prisma.systemTask.findUnique({ where: { idempotencyKey: key } });
    if (existing?.status === "COMPLETED")
      return {
        idempotent: true,
        result: existing.resultJson ? JSON.parse(existing.resultJson) : null,
        taskId: existing.id,
      };
    const acquisition = await this.startTask(taskType, key, marketDate, input, parentTaskId);
    if (!acquisition.acquired) {
      return {
        idempotent: true,
        inProgress: ["PENDING", "RUNNING", "RETRYING"].includes(acquisition.task.status),
        result: acquisition.task.resultJson ? JSON.parse(acquisition.task.resultJson) : null,
        taskId: acquisition.task.id,
      };
    }
    const task = acquisition.task;
    try {
      const result = await run();
      await this.finishTask(task.id, "COMPLETED", result);
      return { idempotent: false, result, taskId: task.id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `${taskType} 失败`;
      await this.failTask(task.id, message);
      throw error;
    }
  }

  private finishTask(id: string, status: "COMPLETED" | "SKIPPED", result: unknown) {
    return this.prisma.systemTask
      .update({
        where: { id },
        data: { completedAt: new Date(), resultJson: JSON.stringify(result), status },
      })
      .then((task) => this.serializeTask(task));
  }

  private failTask(id: string, errorMessage: string) {
    return this.prisma.systemTask.update({
      where: { id },
      data: { completedAt: new Date(), errorMessage, status: "FAILED" },
    });
  }

  private async notify(
    type: string,
    severity: string,
    title: string,
    message: string,
    sourceTaskId: string | null,
    dedupeKey: string,
  ) {
    return this.prisma.systemNotification.upsert({
      where: { dedupeKey },
      update: { message, severity, sourceTaskId, status: "UNREAD" },
      create: { dedupeKey, message, severity, sourceTaskId, title, type },
    });
  }

  private async persistCalendarSession(session: ReturnType<UsMarketCalendarService["session"]>) {
    return this.prisma.tradingCalendarDay.upsert({
      where: {
        market_tradeDate: { market: "US", tradeDate: new Date(`${session.date}T00:00:00.000Z`) },
      },
      update: {
        holidayName: session.holidayName,
        isTradingDay: session.isTradingDay,
        sessionCloseUtc: session.sessionCloseUtc,
        sessionOpenUtc: session.sessionOpenUtc,
      },
      create: {
        market: "US",
        tradeDate: new Date(`${session.date}T00:00:00.000Z`),
        holidayName: session.holidayName,
        isTradingDay: session.isTradingDay,
        sessionCloseUtc: session.sessionCloseUtc,
        sessionOpenUtc: session.sessionOpenUtc,
      },
    });
  }

  private serializeTask<T extends { inputJson: string | null; resultJson: string | null }>(
    task: T,
  ) {
    return {
      ...task,
      input: task.inputJson ? JSON.parse(task.inputJson) : null,
      result: task.resultJson ? JSON.parse(task.resultJson) : null,
    };
  }

  private serializeObservation<
    T extends {
      actualReturn: Prisma.Decimal;
      actualSlippage: Prisma.Decimal;
      comparisonJson: string;
      maxDrawdown: Prisma.Decimal;
      returnDeviation: Prisma.Decimal;
      theoreticalReturn: Prisma.Decimal;
      totalCommission: Prisma.Decimal;
    },
  >(snapshot: T) {
    return {
      ...snapshot,
      actualReturn: toNumber(snapshot.actualReturn),
      actualSlippage: toNumber(snapshot.actualSlippage),
      comparison: JSON.parse(snapshot.comparisonJson),
      maxDrawdown: toNumber(snapshot.maxDrawdown),
      returnDeviation: toNumber(snapshot.returnDeviation),
      theoreticalReturn: toNumber(snapshot.theoreticalReturn),
      totalCommission: toNumber(snapshot.totalCommission),
    };
  }

  private addDays(date: string, days: number) {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }
}
