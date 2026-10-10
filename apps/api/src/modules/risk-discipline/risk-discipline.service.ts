import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskService } from "../risk/risk.service";
import { applyReplayFill } from "./replay-accounting";
import { protectiveStopCompliant } from "../broker-execution/broker-paper.rules";
import type {
  CreatePositionIncidentDto,
  CreatePredefinedScalePlanDto,
  RecordRiskDisciplineOverrideDto,
} from "./risk-discipline.dto";
import {
  calculateEffectiveExposure,
  calculateProfitGiveback,
  disciplineLimits,
  HARD_DISCIPLINE_RULES,
  riskDisciplineEventKey,
  runLeveragedOvernightGapStress,
} from "./risk-discipline.rules";

type ReplayActivity = {
  commission: number;
  price: number;
  quantity: number;
  side: string;
  symbol: string;
  time: Date;
};

type ReplayState = {
  averageCost: number;
  lastClose: number;
  quantity: number;
  realizedPnl: number;
};

@Injectable()
export class RiskDisciplineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskService: RiskService,
  ) {}

  async dashboard(accountId?: string, brokerAccountId?: string) {
    const preferredBrokerAccount = brokerAccountId
      ? await this.prisma.brokerAccount.findUnique({ where: { id: brokerAccountId } })
      : !accountId
        ? await this.prisma.brokerAccount.findFirst({
            where: {
              dataOrigin: "IBKR_PAPER",
              accountType: "PAPER",
              brokerConnection: { enabled: true, environment: "PAPER" },
              status: { in: ["CURRENT", "CONNECTED"] },
            },
            orderBy: { lastSyncedAt: "desc" },
          })
        : null;
    if (brokerAccountId && !preferredBrokerAccount) {
      throw new NotFoundException("未找到指定的 Broker Paper 账户");
    }
    const account = accountId
      ? await this.prisma.account.findUnique({ where: { id: accountId } })
      : preferredBrokerAccount?.localAccountId
        ? await this.prisma.account.findUnique({ where: { id: preferredBrokerAccount.localAccountId } })
        : await this.prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
    if (!account) throw new NotFoundException("未找到风险纪律账户");
    if (preferredBrokerAccount && preferredBrokerAccount.localAccountId !== account.id) throw new BadRequestException("Broker/local account identity mismatch");
    if (!accountId && !preferredBrokerAccount) { const selected = await this.riskService.getSummary(); if (selected.accountId !== account.id) throw new BadRequestException("Explicit account selection required"); }
    const brokerAccounts = preferredBrokerAccount
      ? [{ id: preferredBrokerAccount.id }]
      : await this.prisma.brokerAccount.findMany({
          where: { localAccountId: account.id },
          select: { id: true },
        });
    const brokerAccountIds = brokerAccounts.map((item) => item.id);
    const latestBrokerPositionTime = preferredBrokerAccount
      ? await this.prisma.brokerPositionSnapshot.findFirst({
          where: { brokerAccountId: preferredBrokerAccount.id },
          orderBy: { snapshotTime: "desc" },
          select: { snapshotTime: true },
        })
      : null;
    const [brokerSnapshots, brokerPositions] = preferredBrokerAccount
      ? await Promise.all([
          this.prisma.brokerAccountSnapshot.findMany({
            where: { brokerAccountId: preferredBrokerAccount.id },
            orderBy: { snapshotTime: "asc" },
          }),
          latestBrokerPositionTime
            ? this.prisma.brokerPositionSnapshot.findMany({
                where: {
                  brokerAccountId: preferredBrokerAccount.id,
                  snapshotTime: latestBrokerPositionTime.snapshotTime,
                },
              })
            : [],
        ])
      : [[], []];
    const brokerInstruments = preferredBrokerAccount
      ? await this.prisma.instrument.findMany({
          where: {
            OR: [
              { id: { in: brokerPositions.flatMap((position) => position.instrumentId ?? []) } },
              { symbol: { in: brokerPositions.map((position) => position.symbol) } },
            ],
          },
        })
      : [];
    const instrumentById = new Map(brokerInstruments.map((instrument) => [instrument.id, instrument]));
    const instrumentBySymbol = new Map(
      brokerInstruments.map((instrument) => [instrument.symbol, instrument]),
    );
    const latestBrokerSnapshot = brokerSnapshots.at(-1) ?? null;
    const snapshotOwnerId = preferredBrokerAccount?.id ?? account.id;
    const [
      risk,
      rules,
      equitySnapshots,
      historicalGiveback,
      control,
      proposals,
      events,
      incidents,
      analytics,
    ] =
      await Promise.all([
        preferredBrokerAccount ? Promise.resolve(null) : this.riskService.getSummary(account.id),
        this.prisma.riskRule.findMany({ where: { enabled: true } }),
        this.prisma.accountEquitySnapshot.findMany({
          where: { accountId: snapshotOwnerId },
          orderBy: { snapshotDate: "asc" },
        }),
        this.prisma.profitGivebackSnapshot.aggregate({
          where: { accountId: snapshotOwnerId },
          _max: { peakYtdPnl: true },
        }),
        this.prisma.brokerExecutionControl.findUnique({
          where: { id: "broker-paper-execution-global" },
        }),
        this.prisma.brokerOrderProposal.findMany({
          where: { brokerAccountId: { in: brokerAccountIds } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        this.prisma.riskDisciplineEvent.findMany({
          where: { brokerAccountId: { in: brokerAccountIds } },
          orderBy: { occurredAt: "desc" },
          take: 100,
        }),
        this.prisma.positionIncident.findMany({
          where: preferredBrokerAccount
            ? { brokerAccountId: preferredBrokerAccount.id }
            : {
                OR: [
                  { localAccountId: account.id },
                  ...(brokerAccountIds.length
                    ? brokerAccountIds.map((id) => ({ brokerAccountId: id }))
                    : []),
                ],
              },
          orderBy: { openedAt: "desc" },
          take: 30,
        }),
        this.tradeDisciplineAnalytics(account.id, preferredBrokerAccount?.id),
      ]);
    const brokerExposurePositions = brokerPositions.map((position) => {
      const instrument =
        (position.instrumentId ? instrumentById.get(position.instrumentId) : undefined) ??
        instrumentBySymbol.get(position.symbol);
      return {
        direction: instrument?.direction ?? "LONG",
        industry: instrument?.industry ?? null,
        leveragedETF: instrument?.leveragedETF ?? false,
        leverageMultiplier: instrument ? toNumber(instrument.leverageMultiplier) : 1,
        marketValue: toNumber(position.marketValue),
        riskTheme: instrument?.riskTheme ?? null,
        sector: instrument?.sector ?? null,
        symbol: position.symbol,
        underlyingSymbol: instrument?.underlyingSymbol ?? position.symbol,
      };
    });
    const displayedEquity = preferredBrokerAccount
      ? toNumber(latestBrokerSnapshot?.netLiquidation)
      : risk!.totalEquity;
    const brokerExposure = preferredBrokerAccount
      ? calculateEffectiveExposure(displayedEquity, brokerExposurePositions)
      : null;
    const displayedAnnualNetPnl = preferredBrokerAccount
      ? 0
      : risk!.annualNetPnl;
    const exposureByRiskTheme = brokerExposure?.byRiskTheme ?? risk!.exposureByRiskTheme;
    const dashboardPositions = preferredBrokerAccount
      ? brokerPositions.map((position) => {
          const metadata = brokerExposurePositions.find((item) => item.symbol === position.symbol)!;
          return {
            assetType: metadata.leveragedETF ? "LEVERAGED_ETF" : "STOCK",
            effectiveExposure: Math.abs(
              metadata.marketValue * Math.max(0, metadata.leverageMultiplier),
            ),
            leveragedETF: metadata.leveragedETF,
            marketValue: metadata.marketValue,
            symbol: metadata.symbol,
          };
        })
      : risk!.positions;
    const ruleValues = new Map(rules.map((rule) => [rule.code, toNumber(rule.limitValue)]));
    const peakYtdPnl = Math.max(
      displayedAnnualNetPnl,
      ...(preferredBrokerAccount
        ? []
        : equitySnapshots.map((snapshot) => toNumber(snapshot.realizedPnlYtd))),
      toNumber(historicalGiveback._max.peakYtdPnl),
    );
    const giveback = calculateProfitGiveback({
      currentYtdPnl: displayedAnnualNetPnl,
      defensivePct: ruleValues.get("PROFIT_GIVEBACK_DEFENSIVE_PCT") ?? 25,
      killSwitchPct: ruleValues.get("PROFIT_GIVEBACK_KILL_SWITCH_PCT") ?? 40,
      peakYtdPnl,
      reducedRiskPct: ruleValues.get("PROFIT_GIVEBACK_REDUCED_RISK_PCT") ?? 15,
    });
    const snapshotDate = new Date();
    snapshotDate.setUTCHours(0, 0, 0, 0);
    if (!preferredBrokerAccount) await this.prisma.profitGivebackSnapshot.upsert({
      where: { accountId_snapshotDate: { accountId: snapshotOwnerId, snapshotDate } },
      update: {
        currentYtdPnl: giveback.currentYtdPnl,
        peakYtdPnl: giveback.peakYtdPnl,
        profitGivebackAmount: giveback.profitGivebackAmount,
        profitGivebackPct: giveback.profitGivebackPct,
        state: giveback.state,
      },
      create: {
        accountId: snapshotOwnerId,
        currentYtdPnl: giveback.currentYtdPnl,
        peakYtdPnl: giveback.peakYtdPnl,
        profitGivebackAmount: giveback.profitGivebackAmount,
        profitGivebackPct: giveback.profitGivebackPct,
        snapshotDate,
        state: giveback.state,
      },
    });
    const peakEquity = Math.max(
      displayedEquity,
      ...(preferredBrokerAccount
        ? brokerSnapshots.map((snapshot) => toNumber(snapshot.netLiquidation))
        : equitySnapshots.map((snapshot) => toNumber(snapshot.totalEquity))),
    );
    const currentDrawdownPct =
      peakEquity > 0 ? ((peakEquity - displayedEquity) / peakEquity) * 100 : 0;
    const maxTheme = exposureByRiskTheme[0] ?? null;
    const leveragedSymbols = new Set(
      dashboardPositions
        .filter((position) => position.leveragedETF ?? position.assetType === "LEVERAGED_ETF")
        .map((position) => position.symbol),
    );
    const latestProposalBySymbol = new Map<string, (typeof proposals)[number]>();
    for (const proposal of proposals) {
      if (!latestProposalBySymbol.has(proposal.symbol)) latestProposalBySymbol.set(proposal.symbol, proposal);
    }
    const overnightLeveraged = dashboardPositions
      .filter((position) => leveragedSymbols.has(position.symbol))
      .map((position) => ({
        allowOvernight: latestProposalBySymbol.get(position.symbol)?.allowOvernight ?? null,
        effectiveExposure: position.effectiveExposure,
        marketValue: position.marketValue,
        symbol: position.symbol,
      }));
    const newRiskProposals = proposals.filter((proposal) => proposal.side === "BUY");
    let stopCompliant = newRiskProposals.filter(
      (proposal) => proposal.plannedStopPrice !== null && Boolean(proposal.exitCondition?.trim()),
    ).length;
    let stopTotal = newRiskProposals.length;
    if (preferredBrokerAccount) {
      const orders = await this.prisma.brokerPaperOrder.findMany({ where: { brokerAccountId: preferredBrokerAccount.id, filledQuantity: { gt: 0 } }, include: { executions: { where: { executionRole: "PROTECTION" } } } });
      const openLots = orders.map((order) => ({ filledQuantity: toNumber(order.filledQuantity),
        closedQuantity: order.executions.reduce((sum, fill) => sum + toNumber(fill.quantity), 0),
        stopQuantity: order.protectiveStopQuantity === null ? null : toNumber(order.protectiveStopQuantity),
        stopStatus: order.protectiveStopStatus, stopPrice: order.protectiveStopPrice === null ? null : toNumber(order.protectiveStopPrice),
        stopObservedAt: order.protectiveStopLatestStatusAt })).filter((lot) => lot.filledQuantity > lot.closedQuantity);
      stopTotal = openLots.length;
      stopCompliant = openLots.filter((lot) => protectiveStopCompliant(lot)).length;
    }
    return {
      account: {
        dataOrigin: preferredBrokerAccount?.dataOrigin ?? account.dataOrigin,
        accountType: preferredBrokerAccount?.accountType ?? "LOCAL",
        equity: displayedEquity,
        id: preferredBrokerAccount?.id ?? account.id,
        name: preferredBrokerAccount
          ? `IBKR 模拟账户 ${preferredBrokerAccount.maskedAccountNumber}`
          : account.name,
      },
      auditEvents: events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
      currentDrawdownPct: preferredBrokerAccount ? null : currentDrawdownPct,
      incidents: incidents.map((incident) => this.serializeIncident(incident)),
      killSwitch: {
        level: control?.killSwitchLevel ?? "LEVEL_0_NORMAL",
        reason: control?.reason ?? null,
        safetyState: control?.safetyState ?? "READ_ONLY",
      },
      leveragedEtfPrincipal: brokerExposure?.leveragedEtfPrincipal ?? risk!.leveragedEtfValue,
      leveragedEtfPrincipalPct:
        brokerExposure?.leveragedEtfPrincipalPct ?? risk!.leveragedEtfPercent,
      grossEffectiveExposure: brokerExposure?.grossEffectiveExposure ?? risk!.grossEffectiveExposure,
      grossEffectiveExposurePct:
        brokerExposure?.grossEffectiveExposurePct ?? risk!.grossEffectiveExposurePercent,
      netDirectionalExposure:
        brokerExposure?.netDirectionalExposure ?? risk!.netDirectionalExposure,
      netDirectionalExposurePct:
        brokerExposure?.netDirectionalExposurePct ?? risk!.netDirectionalExposurePercent,
      maxRiskTheme: maxTheme,
      overnightLeveragedExposure: overnightLeveraged,
      profitGiveback: preferredBrokerAccount ? { currentYtdPnl: null, peakYtdPnl: null, profitGivebackAmount: null, profitGivebackPct: null, state: "UNKNOWN", pnlCoverage: "ANNUAL_HISTORY_NOT_VERIFIED" } : giveback,
      recentTradeRiskBudgets: newRiskProposals.slice(0, 20).map((proposal) => ({
        allowOvernight: proposal.allowOvernight,
        createdAt: proposal.createdAt.toISOString(),
        id: proposal.id,
        plannedLoss: proposal.plannedLoss === null ? null : toNumber(proposal.plannedLoss),
        plannedLossPct: proposal.plannedLossPct === null ? null : toNumber(proposal.plannedLossPct),
        status: proposal.status,
        plannedStopPrice:
          proposal.plannedStopPrice === null ? null : toNumber(proposal.plannedStopPrice),
        symbol: proposal.symbol,
      })),
      stopCompliance: {
        compliant: stopCompliant,
        coverage: preferredBrokerAccount ? "OBSERVED_BROKER_PROTECTION" : "LOCAL_PLANS_ONLY",
        ratePct: stopTotal ? (stopCompliant / stopTotal) * 100 : null,
        total: stopTotal,
      },
      losingAddEvents: events.filter((event) => event.ruleCode === "LEVERAGED_ETF_LOSS_ADD_BLOCK").length,
      tradeDiscipline: analytics,
    };
  }

  async createScalePlan(dto: CreatePredefinedScalePlanDto) {
    const symbol = dto.symbol.trim().toUpperCase();
    const expected = `APPROVE SCALE PLAN ${symbol} V${dto.version}`;
    if (dto.confirmationText !== expected) {
      throw new BadRequestException("Predefined Scale Plan 二次确认文本不匹配");
    }
    const [account, instrument, rules, currentPosition, firstImportedExecution, firstPaperExecution] =
      await Promise.all([
      this.prisma.brokerAccount.findUnique({
        where: { id: dto.brokerAccountId },
        include: { snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 } },
      }),
      this.prisma.instrument.findUnique({ where: { symbol } }),
      this.prisma.riskRule.findMany({ where: { enabled: true } }),
      this.prisma.brokerPositionSnapshot.findFirst({
        where: { brokerAccountId: dto.brokerAccountId, symbol },
        orderBy: { snapshotTime: "desc" },
      }),
      this.prisma.brokerExecution.findFirst({
        where: { brokerAccountId: dto.brokerAccountId, symbol },
        orderBy: { executionTime: "asc" },
        select: { id: true },
      }),
      this.prisma.brokerPaperExecution.findFirst({
        where: {
          paperOrder: { brokerAccountId: dto.brokerAccountId, symbol },
        },
        orderBy: { executionTime: "asc" },
        select: { id: true },
      }),
    ]);
    if (!account || account.accountType !== "PAPER" || !account.snapshots[0]) {
      throw new BadRequestException("Scale Plan 只允许在有权益快照的 IBKR Paper 账户创建");
    }
    if (!instrument?.leveragedETF) {
      throw new BadRequestException("本入口仅用于杠杆 ETF 的预定义加仓计划");
    }
    if (
      (currentPosition && Math.abs(toNumber(currentPosition.quantity)) > 0) ||
      firstImportedExecution ||
      firstPaperExecution
    ) {
      throw new BadRequestException("首次成交后不得临时新增摊低成本计划");
    }
    const totalTrancheQuantity = dto.tranches.reduce((sum, tranche) => sum + tranche.quantity, 0);
    if (totalTrancheQuantity > dto.maxTotalQuantity) {
      throw new BadRequestException("Scale Plan 分档数量超过最大总仓位");
    }
    const highestEntry = Math.max(...dto.tranches.map((tranche) => tranche.price));
    const lowestEntry = Math.min(...dto.tranches.map((tranche) => tranche.price));
    if (dto.finalStopPrice >= lowestEntry) {
      throw new BadRequestException("最终 Stop 必须低于所有预定义多头加仓价格");
    }
    const limits = disciplineLimits(
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        limitValue: toNumber(rule.limitValue),
      })),
    );
    const equity = toNumber(account.snapshots[0].netLiquidation);
    const principalPct = ((highestEntry * dto.maxTotalQuantity) / equity) * 100;
    const plannedRiskPct =
      ((highestEntry - dto.finalStopPrice) * dto.maxTotalQuantity + Math.max(1, dto.maxTotalQuantity * 0.005)) /
      equity *
      100;
    if (
      dto.maxPrincipalPercent > limits.leveragedEtfSingleMaxPct ||
      principalPct > dto.maxPrincipalPercent
    ) {
      throw new BadRequestException("Scale Plan 最大本金超过单只杠杆 ETF 上限");
    }
    if (
      dto.maxAccountRiskPct > limits.leveragedEtfMaxRiskPerTradePct ||
      plannedRiskPct > dto.maxAccountRiskPct
    ) {
      throw new BadRequestException("Scale Plan 最大账户风险超过杠杆 ETF Risk Budget");
    }
    if (dto.allowOvernight) {
      const stress = runLeveragedOvernightGapStress({
        accountEquity: equity,
        maxAccountLossPct: limits.overnightGapStressMaxLossPct,
        notional: highestEntry * dto.maxTotalQuantity,
      });
      if (!stress.allowed) throw new BadRequestException("Scale Plan 隔夜 Gap Stress 未通过");
    }
    const normalized = {
      allowOvernight: dto.allowOvernight,
      approvalChain: dto.approvalChain,
      brokerAccountId: dto.brokerAccountId,
      expiresAt: dto.expiresAt ?? null,
      finalStopPrice: dto.finalStopPrice,
      maxAccountRiskPct: dto.maxAccountRiskPct,
      maxPrincipalPercent: dto.maxPrincipalPercent,
      maxTotalQuantity: dto.maxTotalQuantity,
      symbol,
      tranches: dto.tranches,
      version: dto.version,
    };
    const planHash = riskDisciplineEventKey(normalized);
    const existing = await this.prisma.predefinedScalePlan.findUnique({
      where: {
        brokerAccountId_symbol_version: {
          brokerAccountId: dto.brokerAccountId,
          symbol,
          version: dto.version,
        },
      },
    });
    if (existing) {
      if (existing.planHash !== planHash) {
        throw new BadRequestException("同版本 Scale Plan 已存在且内容不同，必须创建新版本");
      }
      return { idempotent: true, plan: this.serializeScalePlan(existing) };
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.predefinedScalePlan.create({
        data: {
          allowOvernight: dto.allowOvernight,
          approvalChainJson: JSON.stringify(dto.approvalChain),
          approvedAt: now,
          brokerAccountId: dto.brokerAccountId,
          createdBy: dto.createdBy,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          finalStopPrice: dto.finalStopPrice,
          maxAccountRiskPct: dto.maxAccountRiskPct,
          maxPrincipalPercent: dto.maxPrincipalPercent,
          maxTotalQuantity: dto.maxTotalQuantity,
          planHash,
          status: "APPROVED",
          symbol,
          tranchesJson: JSON.stringify(dto.tranches),
          version: dto.version,
        },
      });
      await transaction.riskDisciplineEvent.create({
        data: {
          actorId: dto.createdBy,
          approvalChainJson: JSON.stringify(dto.approvalChain),
          brokerAccountId: dto.brokerAccountId,
          decision: "APPROVED",
          eventType: "PREDEFINED_SCALE_PLAN_APPROVED",
          idempotencyKey: riskDisciplineEventKey({ planHash, ruleCode: "PREDEFINED_SCALE_PLAN" }),
          newValueJson: JSON.stringify(normalized),
          occurredAt: now,
          reason: "首次开仓前批准并版本化的 Scale Plan",
          ruleCode: "PREDEFINED_SCALE_PLAN",
          severity: "WARNING",
        },
      });
      return plan;
    });
    return { idempotent: false, plan: this.serializeScalePlan(result) };
  }

  async recordSoftOverride(dto: RecordRiskDisciplineOverrideDto) {
    const ruleCode = dto.ruleCode.trim().toUpperCase();
    const idempotencyKey = riskDisciplineEventKey({
      newValue: dto.newValue,
      oldValue: dto.oldValue,
      operatorId: dto.operatorId,
      ruleCode,
      targetId: dto.targetId,
      targetType: dto.targetType,
    });
    if (HARD_DISCIPLINE_RULES.has(ruleCode)) {
      await this.prisma.riskDisciplineEvent.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          actorId: dto.operatorId,
          approvalChainJson: JSON.stringify(dto.approvalChain),
          decision: "BLOCKED",
          eventType: "HARD_OVERRIDE_BLOCKED",
          idempotencyKey,
          newValueJson: JSON.stringify(dto.newValue),
          occurredAt: new Date(),
          oldValueJson: JSON.stringify(dto.oldValue),
          reason: `硬风控 ${ruleCode} 不允许 Manual Override：${dto.reason}`,
          ruleCode,
          severity: "CRITICAL",
        },
      });
      throw new BadRequestException("普通 Manual Override 不得绕过 Risk Discipline 硬风控");
    }
    const existingEvent = await this.prisma.riskDisciplineEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existingEvent) return { idempotent: true, eventId: existingEvent.id };
    return this.prisma.$transaction(async (transaction) => {
      const override = await transaction.riskDisciplineOverride.create({
        data: {
          approvalChainJson: JSON.stringify(dto.approvalChain),
          classification: "SOFT_WARNING",
          newValueJson: JSON.stringify(dto.newValue),
          oldValueJson: JSON.stringify(dto.oldValue),
          operatorId: dto.operatorId,
          reason: dto.reason,
          ruleCode,
          status: "APPROVED",
          targetId: dto.targetId,
          targetType: dto.targetType,
        },
      });
      const event = await transaction.riskDisciplineEvent.create({
        data: {
          actorId: dto.operatorId,
          approvalChainJson: JSON.stringify(dto.approvalChain),
          decision: "OVERRIDDEN",
          eventType: "SOFT_WARNING_OVERRIDE",
          idempotencyKey,
          newValueJson: JSON.stringify(dto.newValue),
          occurredAt: new Date(),
          oldValueJson: JSON.stringify(dto.oldValue),
          reason: dto.reason,
          ruleCode,
          severity: "WARNING",
        },
      });
      return { eventId: event.id, idempotent: false, overrideId: override.id };
    });
  }

  async createIncident(dto: CreatePositionIncidentDto) {
    if (!dto.brokerAccountId && !dto.localAccountId) {
      throw new BadRequestException("Position Incident 至少需要一个账户来源");
    }
    const normalizedSymbols = [...new Set(dto.symbols.map((symbol) => symbol.trim().toUpperCase()))];
    if (!normalizedSymbols.length || normalizedSymbols.some((symbol) => !symbol)) {
      throw new BadRequestException("Position Incident 至少需要一个有效标的");
    }
    const existing = await this.prisma.positionIncident.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return { idempotent: true, incident: this.serializeIncident(existing) };
    const incident = await this.prisma.positionIncident.create({
      data: {
        brokerAccountId: dto.brokerAccountId,
        closedAt: dto.closedAt ? new Date(dto.closedAt) : null,
        dataGranularity: "DAILY_MAE_APPROXIMATION",
        firstViolationAt: dto.firstViolationAt ? new Date(dto.firstViolationAt) : null,
        idempotencyKey: dto.idempotencyKey,
        localAccountId: dto.localAccountId,
        openedAt: new Date(dto.openedAt),
        riskTheme: dto.riskTheme,
        source: "IBKR_IMPORT_OHLCV",
        status: dto.closedAt ? "CLOSED" : "OPEN",
        symbolsJson: JSON.stringify(normalizedSymbols),
        title: dto.title,
      },
    });
    return { idempotent: false, incident: this.serializeIncident(incident) };
  }

  async incidents() {
    const incidents = await this.prisma.positionIncident.findMany({
      orderBy: { openedAt: "desc" },
      take: 100,
    });
    return incidents.map((incident) => this.serializeIncident(incident));
  }

  async tradeDisciplineAnalytics(accountId?: string, brokerAccountId?: string) {
    const selectedBroker = brokerAccountId ? await this.prisma.brokerAccount.findUnique({ where: { id: brokerAccountId } }) : null;
    if (brokerAccountId && !selectedBroker) throw new NotFoundException("Unknown broker account");
    const selectedAccountId = accountId ?? selectedBroker?.localAccountId ?? (await this.riskService.getSummary()).accountId;
    const account = accountId
      ? await this.prisma.account.findUnique({ where: { id: accountId } })
      : await this.prisma.account.findUnique({ where: { id: selectedAccountId } });
    if (!account) throw new NotFoundException("未找到交易纪律账户");
    if (selectedBroker && selectedBroker.localAccountId !== account.id) throw new BadRequestException("Broker/local account identity mismatch");
    const brokerAccounts = brokerAccountId
      ? await this.prisma.brokerAccount.findMany({
          where: { id: brokerAccountId },
          select: { id: true },
        })
      : await this.prisma.brokerAccount.findMany({
          where: { localAccountId: account.id },
          select: { id: true },
        });
    const brokerAccountIds = brokerAccounts.map((item) => item.id);
    const [trades, events, incidents, proposals, instruments, peakSnapshot] = await Promise.all([
      this.prisma.trade.findMany({
        where: { accountId: brokerAccountId ? "__BROKER_ACCOUNT_ONLY__" : account.id },
        include: { instrument: true },
        orderBy: { tradeDate: "asc" },
      }),
      this.prisma.riskDisciplineEvent.findMany({
        where: { brokerAccountId: { in: brokerAccountIds } },
      }),
      this.prisma.positionIncident.findMany({
        where: brokerAccountId
          ? { brokerAccountId }
          : {
              OR: [
                { localAccountId: account.id },
                ...brokerAccountIds.map((id) => ({ brokerAccountId: id })),
              ],
            },
      }),
      this.prisma.brokerOrderProposal.findMany({
        where: { brokerAccountId: { in: brokerAccountIds } },
      }),
      this.prisma.instrument.findMany({ where: { isActive: true } }),
      this.prisma.accountEquitySnapshot.aggregate({
        where: { accountId: brokerAccountId ?? account.id },
        _max: { realizedPnlYtd: true },
      }),
    ]);
    const outcomes = trades
      .filter((trade) => trade.realizedPnl !== null)
      .map((trade) => toNumber(trade.realizedPnl));
    const winners = outcomes.filter((value) => value > 0);
    const losers = outcomes.filter((value) => value < 0);
    const holding = new Map<string, { openedAt: Date; quantity: number }>();
    const winnerHours: number[] = [];
    const loserHours: number[] = [];
    for (const trade of trades) {
      const quantity = toNumber(trade.quantity);
      const state = holding.get(trade.instrument.symbol) ?? {
        openedAt: trade.tradeDate,
        quantity: 0,
      };
      if (trade.side.toUpperCase().includes("BUY")) {
        if (state.quantity === 0) state.openedAt = trade.tradeDate;
        state.quantity += quantity;
        holding.set(trade.instrument.symbol, state);
      } else if (state.quantity > 0) {
        const duration = Math.max(0, trade.tradeDate.getTime() - state.openedAt.getTime()) / 3_600_000;
        if (toNumber(trade.realizedPnl) >= 0) winnerHours.push(duration);
        else loserHours.push(duration);
        state.quantity = Math.max(0, state.quantity - quantity);
        if (state.quantity === 0) holding.delete(trade.instrument.symbol);
        else holding.set(trade.instrument.symbol, state);
      }
    }
    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const grossProfit = winners.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
    const totalMae = incidents.reduce(
      (sum, incident) => sum + Math.abs(toNumber(incident.maximumUnrealizedLoss)),
      0,
    );
    const totalMfe = incidents.reduce(
      (sum, incident) => sum + Math.max(0, toNumber(incident.maximumFavorableExcursion)),
      0,
    );
    const averageWinnerHoldingHours = average(winnerHours);
    const averageLoserHoldingHours = average(loserHours);
    const averageWin = average(winners);
    const averageLoss = average(losers);
    const losingAddCount = events.filter(
      (event) => event.ruleCode === "LEVERAGED_ETF_LOSS_ADD_BLOCK",
    ).length;
    const dispositionFlags: string[] = [];
    if (winners.length && losers.length && averageWin < Math.abs(averageLoss)) {
      dispositionFlags.push("SMALL_WIN_BIG_LOSS");
    }
    if (winnerHours.length && loserHours.length && averageLoserHoldingHours > averageWinnerHoldingHours) {
      dispositionFlags.push("HOLD_LOSERS_LONGER");
    }
    if (losingAddCount > 0) dispositionFlags.push("AVERAGE_DOWN_LOSERS");
    const peakYtdPnl = Math.max(
      toNumber(account.realizedPnlYtd),
      toNumber(peakSnapshot._max.realizedPnlYtd),
    );
    const maxSingleLoss = losers.length ? Math.min(...losers) : 0;
    const instrumentBySymbol = new Map(
      instruments.map((instrument) => [instrument.symbol, instrument]),
    );
    return {
      coverage: brokerAccountId ? "BROKER_LEDGER_NOT_VERIFIED" : "LOCAL_LEDGER_ONLY",
      averageLoss: brokerAccountId ? null : averageLoss,
      averageLoserHoldingHours: brokerAccountId ? null : averageLoserHoldingHours,
      averageWin: brokerAccountId ? null : averageWin,
      averageWinnerHoldingHours: brokerAccountId ? null : averageWinnerHoldingHours,
      dispositionEffect: {
        detected: brokerAccountId ? false : dispositionFlags.length > 0,
        flags: dispositionFlags,
      },
      leveragedOvernightCount: proposals.filter(
        (proposal) =>
          proposal.allowOvernight === true && instrumentBySymbol.get(proposal.symbol)?.leveragedETF,
      ).length,
      losingAddCount,
      mae: incidents.length ? totalMae / incidents.length : 0,
      maeToRealizedLoss: grossLoss > 0 ? totalMae / grossLoss : null,
      maxSingleLoss: brokerAccountId ? null : maxSingleLoss,
      maxSingleLossToPeakYtdProfitPct: peakYtdPnl > 0 ? (Math.abs(maxSingleLoss) / peakYtdPnl) * 100 : null,
      mfe: incidents.length ? totalMfe / incidents.length : 0,
      mfeCaptureRatio: totalMfe > 0 ? grossProfit / totalMfe : null,
      noStopEntryCount: proposals.filter(
        (proposal) => proposal.side === "BUY" && proposal.plannedStopPrice === null,
      ).length,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      stopAmendmentViolationCount: events.filter(
        (event) => event.ruleCode === "RISK_INCREASING_AMENDMENT",
      ).length,
      strategyOutsideTradeCount: trades.filter((trade) =>
        /OUTSIDE|OFF[_ -]?STRATEGY|计划外/i.test(trade.reason ?? ""),
      ).length,
      tradeCount: brokerAccountId ? null : trades.length,
    };
  }

  async replayIncident(id: string) {
    const incident = await this.prisma.positionIncident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException("Position Incident 不存在");
    const symbols = this.parseSymbols(incident.symbolsJson);
    const end = incident.closedAt ?? new Date();
    const [instruments, bars, corporateActions, brokerExecutions, localTrades, brokerSnapshots, localSnapshots] =
      await Promise.all([
        this.prisma.instrument.findMany({ where: { symbol: { in: symbols } } }),
        this.prisma.marketDataDaily.findMany({
          where: {
            symbol: { in: symbols },
            dataOrigin: incident.source === "SYNTHETIC" ? "SYNTHETIC" : { not: "SYNTHETIC" },
            tradeDate: { gte: incident.openedAt, lte: end },
          },
          orderBy: [{ tradeDate: "asc" }, { symbol: "asc" }],
        }),
        incident.brokerAccountId
          ? this.prisma.brokerCorporateAction.findMany({
              where: {
                actionDate: { gte: incident.openedAt, lte: end },
                brokerAccountId: incident.brokerAccountId,
                symbol: { in: symbols },
              },
              orderBy: { actionDate: "asc" },
            })
          : [],
        incident.brokerAccountId
          ? this.prisma.brokerExecution.findMany({
              where: {
                brokerAccountId: incident.brokerAccountId,
                executionTime: { gte: incident.openedAt, lte: end },
                symbol: { in: symbols },
              },
              orderBy: { executionTime: "asc" },
            })
          : [],
        incident.localAccountId
          ? this.prisma.trade.findMany({
              where: {
                accountId: incident.localAccountId,
                instrument: { symbol: { in: symbols } },
                tradeDate: { gte: incident.openedAt, lte: end },
              },
              include: { instrument: true },
              orderBy: { tradeDate: "asc" },
            })
          : [],
        incident.brokerAccountId
          ? this.prisma.brokerAccountSnapshot.findMany({
              where: {
                brokerAccountId: incident.brokerAccountId,
                snapshotTime: { gte: incident.openedAt, lte: end },
              },
              orderBy: { snapshotTime: "asc" },
            })
          : [],
        incident.localAccountId
          ? this.prisma.accountEquitySnapshot.findMany({
              where: {
                accountId: incident.localAccountId,
                snapshotDate: { gte: incident.openedAt, lte: end },
              },
              orderBy: { snapshotDate: "asc" },
            })
          : [],
      ]);
    if (brokerExecutions.some((execution) => !execution.commissionKnown || execution.commission === null)) throw new BadRequestException("Broker replay requires verified commissions; unknown fees must not be shown as zero");
    const brokerActivities: ReplayActivity[] = brokerExecutions.map((execution) => ({
        commission: toNumber(execution.commission),
        price: toNumber(execution.price),
        quantity: toNumber(execution.quantity),
        side: execution.side,
        symbol: execution.symbol,
        time: execution.executionTime,
      }));
    const localActivities: ReplayActivity[] = localTrades.map((trade) => ({
        commission: toNumber(trade.commission),
        price: toNumber(trade.price),
        quantity: toNumber(trade.quantity),
        side: trade.side,
        symbol: trade.instrument.symbol,
        time: trade.tradeDate,
      }));
    const activities = (brokerActivities.length ? brokerActivities : localActivities).sort(
      (left, right) => left.time.getTime() - right.time.getTime(),
    );
    const instrumentBySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
    const barsByDate = new Map<string, typeof bars>();
    const seenBars = new Set<string>();
    for (const bar of bars) {
      const date = bar.tradeDate.toISOString().slice(0, 10);
      const barKey = `${date}|${bar.symbol}`;
      if (seenBars.has(barKey)) throw new BadRequestException("Multiple OHLCV sources for one replay date; choose a verified source before replay");
      seenBars.add(barKey);
      const rows = barsByDate.get(date) ?? [];
      rows.push(bar);
      barsByDate.set(date, rows);
    }
    const activitiesByDate = new Map<string, ReplayActivity[]>();
    for (const activity of activities) {
      const date = activity.time.toISOString().slice(0, 10);
      const rows = activitiesByDate.get(date) ?? [];
      rows.push(activity);
      activitiesByDate.set(date, rows);
    }
    const actionsByDate = new Map<string, typeof corporateActions>();
    for (const action of corporateActions) {
      const date = action.actionDate.toISOString().slice(0, 10);
      const rows = actionsByDate.get(date) ?? [];
      rows.push(action);
      actionsByDate.set(date, rows);
    }
    const dates = [...new Set([...barsByDate.keys(), ...activitiesByDate.keys(), ...actionsByDate.keys()])].sort();
    const states = new Map<string, ReplayState>(
      symbols.map((symbol) => [symbol, { averageCost: 0, lastClose: 0, quantity: 0, realizedPnl: 0 }]),
    );
    const entries: Array<Record<string, unknown>> = [];
    const splitAdjustments: Array<Record<string, unknown>> = [];
    const timeline: Array<Record<string, unknown>> = [];
    const usedCorporateAction = new Set<string>();
    for (const date of dates) {
      for (const action of actionsByDate.get(date) ?? []) {
        const ratio = toNumber(action.ratio);
        const state = states.get(action.symbol);
        if (state && ratio > 0 && ratio !== 1) {
          state.quantity *= ratio;
          state.averageCost /= ratio;
          usedCorporateAction.add(`${date}|${action.symbol}`);
          splitAdjustments.push({ date, ratio, source: "IBKR_CORPORATE_ACTION", symbol: action.symbol });
        }
      }
      for (const bar of barsByDate.get(date) ?? []) {
        const splitFactor = toNumber(bar.splitFactor);
        const state = states.get(bar.symbol);
        if (
          state &&
          splitFactor > 0 &&
          splitFactor !== 1 &&
          !usedCorporateAction.has(`${date}|${bar.symbol}`)
        ) {
          state.quantity *= splitFactor;
          state.averageCost /= splitFactor;
          splitAdjustments.push({ date, ratio: splitFactor, source: bar.dataOrigin === "SYNTHETIC" ? "SYNTHETIC_SPLIT_FACTOR" : "OHLCV_SPLIT_FACTOR", symbol: bar.symbol });
        }
      }
      for (const activity of activitiesByDate.get(date) ?? []) {
        const state = states.get(activity.symbol)!;
        const fill = applyReplayFill(state, activity.side, activity.quantity, activity.price, activity.commission);
        Object.assign(state, { averageCost: fill.averageCost, quantity: fill.quantity, realizedPnl: fill.realizedPnl });
        entries.push({ averageCostAfter: state.averageCost, price: activity.price, quantity: activity.quantity,
          realizedPnlAfter: state.realizedPnl, stage: fill.stage, symbol: activity.symbol, time: activity.time.toISOString() });
      }
      const exactBars = new Map((barsByDate.get(date) ?? []).map((bar) => [bar.symbol, bar]));
      const accountEquity = this.equityAt(date, brokerSnapshots, localSnapshots);
      let costBasis = 0;
      let marketValue = 0;
      let effectiveLeverageExposure = 0;
      let dailyMae = 0;
      let dailyMfe = 0;
      let unrealizedPnl = 0;
      const positions: Array<Record<string, unknown>> = [];
      for (const symbol of symbols) {
        const state = states.get(symbol)!;
        const bar = exactBars.get(symbol);
        if (bar) state.lastClose = toNumber(bar.close);
        const close = state.lastClose || state.averageCost;
        const low = bar ? toNumber(bar.low) : close;
        const high = bar ? toNumber(bar.high) : close;
        const symbolMarketValue = state.quantity * close;
        const symbolCost = state.quantity * state.averageCost;
        const symbolMae = state.quantity * ((state.quantity < 0 ? high : low) - state.averageCost);
        const symbolMfe = state.quantity * ((state.quantity < 0 ? low : high) - state.averageCost);
        const leverage = instrumentBySymbol.get(symbol)
          ? toNumber(instrumentBySymbol.get(symbol)!.leverageMultiplier)
          : 1;
        costBasis += symbolCost;
        marketValue += symbolMarketValue;
        effectiveLeverageExposure += Math.abs(symbolMarketValue * leverage);
        dailyMae += Math.min(0, symbolMae);
        dailyMfe += Math.max(0, symbolMfe);
        unrealizedPnl += symbolMarketValue - symbolCost;
        positions.push({
          averageCost: state.averageCost,
          close,
          dailyMae: symbolMae,
          dailyMfe: symbolMfe,
          effectiveLeverageExposure: Math.abs(symbolMarketValue * leverage),
          marketValue: symbolMarketValue,
          quantity: state.quantity,
          symbol,
        });
      }
      timeline.push({
        accountEquity,
        accountEquityPercent: accountEquity !== null && accountEquity > 0 ? (Math.abs(marketValue) / accountEquity) * 100 : null,
        costBasis,
        dailyMae,
        dailyMfe,
        date,
        effectiveLeverageExposure,
        effectiveLeverageExposurePct:
          accountEquity !== null && accountEquity > 0 ? (effectiveLeverageExposure / accountEquity) * 100 : null,
        marketValue,
        positions,
        unrealizedPnl,
      });
    }
    const maximumUnrealizedLoss = Math.min(
      0,
      ...timeline.flatMap((row) => [Number(row.dailyMae), Number(row.unrealizedPnl)]),
    );
    const maximumFavorableExcursion = Math.max(
      0,
      ...timeline.map((row) => Number(row.dailyMfe)),
    );
    const reconstructedRealizedPnl = [...states.values()].reduce(
      (sum, state) => sum + state.realizedPnl,
      0,
    );
    const hasReconstructedExit = entries.some((entry) => entry.stage === "EXIT");
    const finalRealizedPnl = hasReconstructedExit
      ? reconstructedRealizedPnl
      : toNumber(incident.finalRealizedPnl);
    const mfeCaptureRatio =
      maximumFavorableExcursion > 0
        ? Math.max(0, finalRealizedPnl) / maximumFavorableExcursion
        : null;
    const maeToRealizedLoss =
      finalRealizedPnl < 0 ? Math.abs(maximumUnrealizedLoss / finalRealizedPnl) : null;
    const updatedIncident = await this.prisma.positionIncident.update({
      where: { id },
      data: {
        finalRealizedPnl,
        maeToRealizedLoss,
        maximumFavorableExcursion,
        maximumUnrealizedLoss,
        mfeCaptureRatio,
      },
    });
    return {
      dataGranularity: "DAILY_MAE_APPROXIMATION",
      entries,
      finalRealizedPnl,
      firstViolationToCloseHours:
        incident.firstViolationAt && incident.closedAt
          ? Math.max(0, incident.closedAt.getTime() - incident.firstViolationAt.getTime()) /
            3_600_000
          : null,
      incident: this.serializeIncident(updatedIncident),
      maeToRealizedLoss,
      maximumFavorableExcursion,
      maximumUnrealizedLoss,
      mfeCaptureRatio,
      methodology:
        "Daily MAE approximation：仅使用 Daily OHLCV 的 Low/High 估算每日 MAE/MFE，不代表精确盘中路径或可成交价格。",
      splitAdjustments,
      timeline,
    };
  }

  private equityAt(
    date: string,
    brokerSnapshots: Array<{ netLiquidation: Prisma.Decimal; snapshotTime: Date }>,
    localSnapshots: Array<{ snapshotDate: Date; totalEquity: Prisma.Decimal }>,
  ) {
    const cutoff = new Date(`${date}T23:59:59.999Z`).getTime();
    const broker =
      brokerSnapshots.filter((item) => item.snapshotTime.getTime() <= cutoff).at(-1);
    if (broker) return toNumber(broker.netLiquidation);
    const local =
      localSnapshots.filter((item) => item.snapshotDate.getTime() <= cutoff).at(-1);
    return local ? toNumber(local.totalEquity) : null;
  }

  private parseSymbols(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? [...new Set(parsed.map((item) => String(item).trim().toUpperCase()).filter(Boolean))]
        : [];
    } catch {
      return [];
    }
  }

  private serializeIncident(incident: {
    brokerAccountId: string | null;
    closedAt: Date | null;
    createdAt: Date;
    dataGranularity: string;
    finalRealizedPnl: Prisma.Decimal | null;
    firstViolationAt: Date | null;
    id: string;
    idempotencyKey: string;
    localAccountId: string | null;
    maeToRealizedLoss: Prisma.Decimal | null;
    maximumFavorableExcursion: Prisma.Decimal | null;
    maximumUnrealizedLoss: Prisma.Decimal | null;
    mfeCaptureRatio: Prisma.Decimal | null;
    openedAt: Date;
    riskTheme: string | null;
    source: string;
    status: string;
    symbolsJson: string;
    title: string;
    updatedAt: Date;
  }) {
    return {
      ...incident,
      closedAt: incident.closedAt?.toISOString() ?? null,
      createdAt: incident.createdAt.toISOString(),
      finalRealizedPnl:
        incident.finalRealizedPnl === null ? null : toNumber(incident.finalRealizedPnl),
      firstViolationAt: incident.firstViolationAt?.toISOString() ?? null,
      maeToRealizedLoss:
        incident.maeToRealizedLoss === null ? null : toNumber(incident.maeToRealizedLoss),
      maximumFavorableExcursion:
        incident.maximumFavorableExcursion === null
          ? null
          : toNumber(incident.maximumFavorableExcursion),
      maximumUnrealizedLoss:
        incident.maximumUnrealizedLoss === null
          ? null
          : toNumber(incident.maximumUnrealizedLoss),
      mfeCaptureRatio:
        incident.mfeCaptureRatio === null ? null : toNumber(incident.mfeCaptureRatio),
      openedAt: incident.openedAt.toISOString(),
      symbols: this.parseSymbols(incident.symbolsJson),
      updatedAt: incident.updatedAt.toISOString(),
    };
  }

  private serializeScalePlan(plan: {
    allowOvernight: boolean;
    approvedAt: Date;
    approvalChainJson: string;
    brokerAccountId: string;
    createdAt: Date;
    createdBy: string;
    expiresAt: Date | null;
    finalStopPrice: Prisma.Decimal;
    firstFilledAt: Date | null;
    id: string;
    lockedAt: Date | null;
    maxAccountRiskPct: Prisma.Decimal;
    maxPrincipalPercent: Prisma.Decimal;
    maxTotalQuantity: Prisma.Decimal;
    planHash: string;
    status: string;
    symbol: string;
    tranchesJson: string;
    updatedAt: Date;
    version: number;
  }) {
    return {
      ...plan,
      finalStopPrice: toNumber(plan.finalStopPrice),
      maxAccountRiskPct: toNumber(plan.maxAccountRiskPct),
      maxPrincipalPercent: toNumber(plan.maxPrincipalPercent),
      maxTotalQuantity: toNumber(plan.maxTotalQuantity),
      tranches: JSON.parse(plan.tranchesJson) as unknown,
    };
  }
}
