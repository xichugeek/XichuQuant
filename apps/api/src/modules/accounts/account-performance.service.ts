import { cashFlowAdjustedSeries, realizedTradeProfitFactor } from "./performance-accounting";
import { cashImpact } from "../imports/portfolio-accounting";
import type { NormalizedImportRecord } from "../imports/import.types";
import { Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskService } from "../risk/risk.service";
import type { CreateEquitySnapshotDto } from "./account.dto";

const PERIODS = ["1M", "3M", "YTD", "1Y", "ALL"] as const;
type PerformancePeriod = (typeof PERIODS)[number];

@Injectable()
export class AccountPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskService: RiskService,
  ) {}

  async getCurrentPaperPerformance(requestedPeriod?: string) {
    const brokerAccount = await this.prisma.brokerAccount.findFirst({
      where: { dataOrigin: "IBKR_PAPER", brokerConnection: { enabled: true, environment: "PAPER", runMode: "IBKR_PAPER" }, accountType: "PAPER", status: { in: ["CURRENT", "CONNECTED"] } },
      include: { snapshots: { orderBy: { snapshotTime: "asc" } } },
      orderBy: [{ lastSyncedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!brokerAccount || brokerAccount.snapshots.length === 0) {
      throw new NotFoundException("未找到已同步的 IBKR Paper 账户快照");
    }

    const period = this.normalizePeriod(requestedPeriod);
    const latestByDate = new Map<string, (typeof brokerAccount.snapshots)[number]>();
    for (const snapshot of brokerAccount.snapshots) {
      latestByDate.set(snapshot.snapshotTime.toISOString().slice(0, 10), snapshot);
    }
    const dailySnapshots = [...latestByDate.values()];
    const latest = dailySnapshots.at(-1)!;
    const cutoff = this.getCutoff(period, latest.snapshotTime);
    const filtered = dailySnapshots.filter(
      (snapshot) => !cutoff || snapshot.snapshotTime >= cutoff,
    );
    const effectiveSnapshots = filtered.length > 0 ? filtered : dailySnapshots.slice(-1);
    const initialCapital = toNumber(dailySnapshots[0]!.netLiquidation);
    const firstEquity = toNumber(effectiveSnapshots[0]!.netLiquidation);
    const currentEquity = toNumber(latest.netLiquidation);
    const series = effectiveSnapshots.map((snapshot) => {
      const equity = toNumber(snapshot.netLiquidation);
      return {
        date: snapshot.snapshotTime.toISOString().slice(0, 10),
        equity,
        cashBalance: toNumber(snapshot.totalCash),
        realizedPnlYtd: null,
        periodPnl: null,
        periodReturnPercent: null,
        drawdownPercent: null,
        note: "IBKR Paper 每日最新同步快照",
      };
    });


    return {
      dataOrigin: "IBKR_PAPER",
      returnsVerified: false,
      returnsStatus: "CASH_FLOW_HISTORY_NOT_VERIFIED",
      realizedPnlPeriod: "BROKER_SESSION",
      brokerSessionRealizedPnl: toNumber(latest.realizedPnl),
      accountId: brokerAccount.id,
      accountName: `IBKR 模拟账户 ${brokerAccount.maskedAccountNumber}`,
      accountType: brokerAccount.accountType,
      dataSource: "BROKER_SYNC" as const,
      snapshotTime: latest.snapshotTime.toISOString(),
      period,
      periodLabel: this.periodLabel(period),
      initialCapital,
      periodStartEquity: firstEquity,
      currentEquity,
      totalNetPnl: null,
      totalReturnPercent:
        null,
      periodPnl: null,
      periodReturnPercent: null,
      realizedPnlYtd: null,
      unrealizedPnl: toNumber(latest.unrealizedPnl),
      cashBalance: toNumber(latest.totalCash),
      cashPercent:
        currentEquity > 0 ? (toNumber(latest.totalCash) / currentEquity) * 100 : 0,
      peakEquity: Math.max(firstEquity, ...series.map((point) => point.equity)),
      maxDrawdownPercent: null,
      profitPeriods: 0,
      lossPeriods: 0,
      winRatePercent: 0,
      profitFactor: null,
      series,
    };
  }

  async getPerformance(accountId: string, requestedPeriod?: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("账户不存在");
    const period = this.normalizePeriod(requestedPeriod);
    const allSnapshots = await this.prisma.accountEquitySnapshot.findMany({
      where: { accountId },
      orderBy: { snapshotDate: "asc" },
    });
    const risk = await this.riskService.getSummary(accountId);
    const latestDate = allSnapshots.at(-1)?.snapshotDate ?? new Date();
    const cutoff = this.getCutoff(period, latestDate);
    const snapshots = allSnapshots.filter((snapshot) => !cutoff || snapshot.snapshotDate >= cutoff);
    const effectiveSnapshots = snapshots.length > 0 ? snapshots : allSnapshots.slice(-1);
    const initialCapital = toNumber(account.initialCapital);
    const firstEquity = toNumber(effectiveSnapshots[0]?.totalEquity ?? account.totalEquity);
    const currentEquity = toNumber(effectiveSnapshots.at(-1)?.totalEquity ?? account.totalEquity);
    const importedFlows = await this.prisma.importRecord.findMany({ where: {
      accountId, status: "IMPORTED", recordType: { in: ["DEPOSIT", "WITHDRAWAL"] },
    } });
    const flows = importedFlows.map((record) => {
      const normalized = JSON.parse(record.normalizedData) as NormalizedImportRecord;
      if (!record.transactionDate) throw new Error("External cash flow date is unknown");
      return { time: record.transactionDate, amount: cashImpact(normalized, account.baseCurrency) };
    });
    const adjusted = cashFlowAdjustedSeries(effectiveSnapshots.map((snapshot) => ({ time: snapshot.snapshotDate, equity: toNumber(snapshot.totalEquity) })), flows);
    const allAdjusted = cashFlowAdjustedSeries(allSnapshots.map((snapshot) => ({ time: snapshot.snapshotDate, equity: toNumber(snapshot.totalEquity) })), flows);
    const realizedTrades = await this.prisma.trade.findMany({ where: { accountId, realizedPnl: { not: null }, ...(cutoff ? { tradeDate: { gte: cutoff } } : {}) }, select: { realizedPnl: true } });
    const series = effectiveSnapshots.map((snapshot, index) => ({
      date: snapshot.snapshotDate.toISOString().slice(0, 10), equity: toNumber(snapshot.totalEquity),
      cashBalance: toNumber(snapshot.cashBalance), realizedPnlYtd: toNumber(snapshot.realizedPnlYtd),
      periodPnl: adjusted[index]!.periodPnl, periodReturnPercent: adjusted[index]!.periodReturnPercent,
      drawdownPercent: adjusted[index]!.drawdownPercent, note: snapshot.note,
    }));
    const profitPeriods = adjusted.filter((point) => point.dailyPnl > 0).length;
    const lossPeriods = adjusted.filter((point) => point.dailyPnl < 0).length;
    const measuredPeriods = profitPeriods + lossPeriods;
    const periodPnl = adjusted.at(-1)?.periodPnl ?? 0;
    const returnsKnown = effectiveSnapshots.length >= 2;
    const allReturnsKnown = allSnapshots.length >= 2;
    return {
      dataOrigin: account.dataOrigin, returnsVerified: returnsKnown, returnsStatus: returnsKnown ? "IMPORTED_CASH_FLOWS_ADJUSTED" : "INSUFFICIENT_EQUITY_HISTORY",
      profitFactorBasis: "REALIZED_TRADES", accountId, accountName: account.name, period, periodLabel: this.periodLabel(period),
      initialCapital, periodStartEquity: firstEquity, currentEquity,
      totalNetPnl: allReturnsKnown ? allAdjusted.at(-1)!.periodPnl : null, totalReturnPercent: allReturnsKnown ? allAdjusted.at(-1)!.periodReturnPercent : null,
      periodPnl: returnsKnown ? periodPnl : null, periodReturnPercent: returnsKnown ? adjusted.at(-1)!.periodReturnPercent : null,
      realizedPnlYtd: risk.realizedPnlYtd, unrealizedPnl: risk.unrealizedPnlTotal,
      cashBalance: risk.cashBalance, cashPercent: risk.cashPercent, peakEquity: Math.max(firstEquity, ...series.map((point) => point.equity)),
      maxDrawdownPercent: returnsKnown ? Math.min(0, ...adjusted.map((point) => point.drawdownPercent)) : null,
      profitPeriods, lossPeriods, winRatePercent: measuredPeriods > 0 ? profitPeriods / measuredPeriods * 100 : 0,
      profitFactor: realizedTradeProfitFactor(realizedTrades.map((trade) => toNumber(trade.realizedPnl))), series,
    };
  }

  async addSnapshot(accountId: string, dto: CreateEquitySnapshotDto) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("账户不存在");
    const snapshotDate = new Date(dto.snapshotDate);
    return this.prisma.accountEquitySnapshot.upsert({
      where: { accountId_snapshotDate: { accountId, snapshotDate } },
      update: {
        totalEquity: dto.totalEquity,
        cashBalance: dto.cashBalance,
        realizedPnlYtd: dto.realizedPnlYtd,
        note: dto.note,
      },
      create: {
        accountId,
        snapshotDate,
        totalEquity: dto.totalEquity,
        cashBalance: dto.cashBalance,
        realizedPnlYtd: dto.realizedPnlYtd,
        note: dto.note,
      },
    });
  }

  private normalizePeriod(period?: string): PerformancePeriod {
    return PERIODS.includes(period as PerformancePeriod) ? (period as PerformancePeriod) : "YTD";
  }

  private getCutoff(period: PerformancePeriod, latest: Date): Date | null {
    if (period === "ALL") return null;
    if (period === "YTD") return new Date(Date.UTC(latest.getUTCFullYear(), 0, 1));
    const cutoff = new Date(latest);
    if (period === "1M") cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
    if (period === "3M") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
    if (period === "1Y") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    return cutoff;
  }

  private periodLabel(period: PerformancePeriod): string {
    return { "1M": "近 1 月", "3M": "近 3 月", YTD: "今年", "1Y": "近 1 年", ALL: "全部" }[period];
  }
}
