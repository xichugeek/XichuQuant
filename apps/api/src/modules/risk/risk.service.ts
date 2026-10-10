import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskEngineService } from "./risk-engine.service";
import type { RiskSummary } from "./risk.types";

@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngine: RiskEngineService,
  ) {}

  async getSummary(accountId?: string): Promise<RiskSummary> {
    return this.evaluateWithClient(this.prisma, accountId);
  }

  async evaluateAndPersist(accountId?: string): Promise<RiskSummary> {
    const summary = await this.evaluateWithClient(this.prisma, accountId);
    await this.prisma.$transaction(async (transaction) => {
      await this.persistAlerts(transaction, summary);
    });
    return summary;
  }

  async evaluateAndPersistInTransaction(
    transaction: Prisma.TransactionClient,
    accountId: string,
  ): Promise<RiskSummary> {
    const summary = await this.evaluateWithClient(transaction, accountId);
    await this.persistAlerts(transaction, summary);
    return summary;
  }

  private async evaluateWithClient(
    client: PrismaService | Prisma.TransactionClient,
    accountId?: string,
  ): Promise<RiskSummary> {
    if (!accountId) {
      const brokerSummary = await this.evaluateCurrentPaperBroker(client);
      if (brokerSummary) return brokerSummary;
      if (await client.brokerConnection.findFirst({ where: { enabled: true, environment: "PAPER", runMode: "IBKR_PAPER" } })) throw new ServiceUnavailableException("Configured IBKR Paper account is unavailable; demo fallback is forbidden");
    }

    const candidates = !accountId ? await client.account.findMany({ where: process.env.XICHURISK_DATA_MODE === "DEMO" ? { dataOrigin: "DEMO" } : { dataOrigin: { not: "DEMO" } } }) : [];
    if (!accountId && candidates.length > 1) throw new ServiceUnavailableException("Multiple accounts require explicit accountId");
    const account = accountId
      ? await client.account.findUnique({ where: { id: accountId } })
      : candidates[0];
    if (!account) throw new NotFoundException("未找到投资账户");

    const [positions, rules] = await Promise.all([
      client.position.findMany({
        where: { accountId: account.id },
        include: { instrument: true },
        orderBy: { createdAt: "asc" },
      }),
      client.riskRule.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    const summary = this.riskEngine.evaluate(
      {
        id: account.id,
        name: account.name,
        totalEquity: toNumber(account.totalEquity),
        cashBalance: toNumber(account.cashBalance),
        realizedPnlYtd: toNumber(account.realizedPnlYtd),
      },
      positions.map((position) => ({
        id: position.id,
        symbol: position.instrument.symbol,
        name: position.instrument.name ?? position.instrument.symbol,
        assetType: position.instrument.assetType,
        category: position.instrument.category,
        theme: position.instrument.theme,
        underlyingSymbol: position.instrument.underlyingSymbol,
        riskTheme: position.instrument.riskTheme,
        sector: position.instrument.sector,
        industry: position.instrument.industry,
        leverageMultiplier: toNumber(position.instrument.leverageMultiplier),
        direction: position.instrument.direction,
        leveragedETF: position.instrument.leveragedETF,
        quantity: toNumber(position.quantity),
        avgCost: toNumber(position.avgCost),
        currentPrice: toNumber(position.currentPrice),
      })),
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        level: rule.level,
        limitValue: toNumber(rule.limitValue),
      })),
    );

    return {
      ...summary,
      dataOrigin: account.dataOrigin,
      accountType: "LOCAL",
      dataSource: "LOCAL_ACCOUNT",
      snapshotTime: account.updatedAt.toISOString(),
    };
  }

  private async evaluateCurrentPaperBroker(
    client: PrismaService | Prisma.TransactionClient,
  ): Promise<RiskSummary | null> {
    const brokerAccount = await client.brokerAccount.findFirst({
      where: {
        dataOrigin: "IBKR_PAPER",
        brokerConnection: { enabled: true, environment: "PAPER", runMode: "IBKR_PAPER" },
        accountType: "PAPER",
        localAccountId: { not: null },
        status: { in: ["CURRENT", "CONNECTED"] },
      },
      include: {
        snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
      },
      orderBy: [{ lastSyncedAt: "desc" }, { createdAt: "desc" }],
    });
    const snapshot = brokerAccount?.snapshots[0];
    if (!brokerAccount?.localAccountId || !snapshot) return null;

    const freshness = Date.now() - (brokerAccount.lastSyncedAt?.getTime() ?? snapshot.snapshotTime.getTime());
    if (freshness > 90000 || freshness < -5000) throw new ServiceUnavailableException("Broker snapshot is stale");
    const [positions, rules, instruments] = await Promise.all([
      client.brokerPositionSnapshot.findMany({
        where: {
          brokerAccountId: brokerAccount.id,
          snapshotTime: snapshot.snapshotTime,
        },
        orderBy: { symbol: "asc" },
      }),
      client.riskRule.findMany({ orderBy: { createdAt: "asc" } }),
      client.instrument.findMany(),
    ]);
    const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
    const instrumentBySymbol = new Map(
      instruments.map((instrument) => [instrument.symbol, instrument]),
    );
    const summary = this.riskEngine.evaluate(
      {
        id: brokerAccount.localAccountId,
        name: `IBKR 模拟账户 ${brokerAccount.maskedAccountNumber}`,
        totalEquity: toNumber(snapshot.netLiquidation),
        cashBalance: toNumber(snapshot.totalCash),
        realizedPnlYtd: 0,
      },
      positions.map((position) => {
        const instrument =
          (position.instrumentId ? instrumentById.get(position.instrumentId) : undefined) ??
          instrumentBySymbol.get(position.symbol);
        const quantity = toNumber(position.quantity);
        return {
          id: position.id,
          symbol: position.symbol,
          name: instrument?.name ?? position.symbol,
          assetType: instrument?.assetType ?? "UNKNOWN",
          category: instrument?.category ?? null,
          theme: instrument?.theme ?? null,
          underlyingSymbol: instrument?.underlyingSymbol ?? position.symbol,
          riskTheme: instrument?.riskTheme ?? instrument?.theme ?? null,
          sector: instrument?.sector ?? null,
          industry: instrument?.industry ?? null,
          leverageMultiplier: instrument ? toNumber(instrument.leverageMultiplier) : 1,
          direction: instrument?.direction ?? "LONG",
          leveragedETF: instrument?.leveragedETF ?? false,
          quantity,
          avgCost: toNumber(position.averageCost),
          currentPrice: toNumber(position.marketPrice),
        };
      }),
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        level: rule.level,
        limitValue: toNumber(rule.limitValue),
      })),
    );

    return {
      ...summary,
      dataOrigin: brokerAccount.dataOrigin,
      annualPnlKnown: false,
      realizedPnlPeriod: "BROKER_SESSION",
      brokerSessionRealizedPnl: toNumber(snapshot.realizedPnl),
      accountType: brokerAccount.accountType,
      brokerAccountId: brokerAccount.id,
      dataSource: "BROKER_SYNC",
      snapshotTime: snapshot.snapshotTime.toISOString(),
    };
  }

  private async persistAlerts(
    transaction: Prisma.TransactionClient,
    summary: RiskSummary,
  ): Promise<void> {
    const existing = await transaction.riskAlert.findMany({ where: { accountId: summary.accountId, isResolved: false } });
    const key = (alert: { ruleCode?: string; code?: string; level: string; symbol?: string | null; currentValue?: unknown; limitValue?: unknown; title: string; message: string }) => JSON.stringify([
      alert.ruleCode ?? alert.code, alert.level, alert.symbol ?? null, alert.title, alert.message,
      alert.currentValue === null || alert.currentValue === undefined ? null : Number(Number(alert.currentValue).toFixed(4)),
      alert.limitValue === null || alert.limitValue === undefined ? null : Number(Number(alert.limitValue).toFixed(4)),
    ]);
    if (JSON.stringify(existing.map(key).sort()) === JSON.stringify(summary.alerts.map(key).sort())) return;
    await transaction.riskAlert.updateMany({
      where: { accountId: summary.accountId, isResolved: false },
      data: { isResolved: true, resolvedAt: new Date() },
    });
    if (summary.alerts.length > 0) {
      await transaction.riskAlert.createMany({
        data: summary.alerts.map((alert) => ({
          accountId: summary.accountId,
          ruleCode: alert.code,
          level: alert.level,
          title: alert.title,
          message: alert.message,
          symbol: alert.symbol,
          currentValue: alert.currentValue,
          limitValue: alert.limitValue,
          suggestedAction: alert.suggestedAction,
        })),
      });
    }
  }
}
