import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskEngineService } from "../risk/risk-engine.service";
import type { RiskPositionInput, RiskRuleInput } from "../risk/risk.types";
import type { CreateSignalDto, UpdateSignalStatusDto } from "./signal.dto";

type RiskViolation = {
  code: string;
  currentValue: number | null;
  expectedValue: number | null;
  limitValue: number | null;
  reason: string;
};

@Injectable()
export class SignalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngine: RiskEngineService,
  ) {}

  async list() {
    const signals = await this.prisma.strategySignal.findMany({
      include: { account: { select: { id: true, name: true } }, strategy: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return signals.map((signal) => this.serialize(signal));
  }

  async create(dto: CreateSignalDto) {
    const [strategy, account] = await Promise.all([
      this.prisma.strategy.findUnique({ where: { id: dto.strategyId } }),
      dto.accountId
        ? this.prisma.account.findUnique({ where: { id: dto.accountId } })
        : this.prisma.account.findFirst({ orderBy: { createdAt: "asc" } }),
    ]);
    if (!strategy) throw new NotFoundException("策略不存在");
    if (!account) throw new NotFoundException("审查账户不存在");
    const signal = await this.prisma.strategySignal.create({
      data: {
        strategyId: strategy.id,
        accountId: account.id,
        symbol: dto.symbol.toUpperCase(),
        signalType: dto.signalType,
        signalTime: new Date(),
        requestedAmount: dto.requestedAmount,
        referencePrice: dto.referencePrice,
        stopLossCondition: dto.stopLossCondition,
        exitCondition: dto.exitCondition,
        triggerReason: dto.triggerReason,
        status: "GENERATED",
      },
    });
    return this.review(signal.id);
  }

  async review(id: string) {
    const signal = await this.prisma.strategySignal.findUnique({ where: { id } });
    if (!signal) throw new NotFoundException("策略信号不存在");
    const account = signal.accountId
      ? await this.prisma.account.findUnique({ where: { id: signal.accountId } })
      : await this.prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
    if (!account) throw new NotFoundException("审查账户不存在");
    if (signal.signalType !== "BUY") {
      return this.updateReview(signal.id, account.id, "RISK_APPROVED", [], "卖出信号不增加仓位风险");
    }

    const [instrument, positions, dbRules] = await Promise.all([
      this.prisma.instrument.findUnique({ where: { symbol: signal.symbol } }),
      this.prisma.position.findMany({
        where: { accountId: account.id },
        include: { instrument: true },
      }),
      this.prisma.riskRule.findMany({ where: { enabled: true } }),
    ]);
    if (!instrument) {
      return this.updateReview(signal.id, account.id, "RISK_REJECTED", [
        {
          code: "INSTRUMENT_UNKNOWN",
          currentValue: null,
          expectedValue: null,
          limitValue: null,
          reason: "标的未录入系统，无法可靠判断资产类型和主题风险",
        },
      ]);
    }
    const requestedAmount = toNumber(signal.requestedAmount);
    const referencePrice = toNumber(signal.referencePrice);
    const accountInput = {
      id: account.id,
      name: account.name,
      totalEquity: toNumber(account.totalEquity),
      cashBalance: toNumber(account.cashBalance),
      realizedPnlYtd: toNumber(account.realizedPnlYtd),
    };
    const rules: RiskRuleInput[] = dbRules.map((rule) => ({
      code: rule.code,
      enabled: rule.enabled,
      level: rule.level,
      limitValue: toNumber(rule.limitValue),
    }));
    const currentPositions: RiskPositionInput[] = positions.map((position) => ({
      id: position.id,
      symbol: position.instrument.symbol,
      name: position.instrument.name ?? position.instrument.symbol,
      assetType: position.instrument.assetType,
      category: position.instrument.category,
      theme: position.instrument.theme,
      quantity: toNumber(position.quantity),
      avgCost: toNumber(position.avgCost),
      currentPrice: toNumber(position.currentPrice),
    }));
    const projectedPositions = currentPositions.map((position) => ({ ...position }));
    const existing = projectedPositions.find((position) => position.symbol === signal.symbol);
    if (existing) {
      const oldCost = existing.quantity * existing.avgCost;
      const addedQuantity = requestedAmount / referencePrice;
      existing.quantity += addedQuantity;
      existing.avgCost = (oldCost + requestedAmount) / existing.quantity;
      existing.currentPrice = referencePrice;
    } else {
      projectedPositions.push({
        id: `signal-${signal.id}`,
        symbol: instrument.symbol,
        name: instrument.name ?? instrument.symbol,
        assetType: instrument.assetType,
        category: instrument.category,
        theme: instrument.theme,
        quantity: requestedAmount / referencePrice,
        avgCost: referencePrice,
        currentPrice: referencePrice,
      });
    }
    const current = this.riskEngine.evaluate(accountInput, currentPositions, rules);
    const projected = this.riskEngine.evaluate(
      { ...accountInput, cashBalance: accountInput.cashBalance - requestedAmount },
      projectedPositions,
      rules,
    );
    const limits = Object.fromEntries(rules.map((rule) => [rule.code, rule.limitValue]));
    const violations: RiskViolation[] = [];
    const add = (violation: RiskViolation) => {
      if (!violations.some((item) => item.code === violation.code)) violations.push(violation);
    };
    if (!signal.stopLossCondition?.trim() || !signal.exitCondition?.trim()) {
      add({
        code: "ENTRY_EXIT_REQUIRED",
        currentValue: null,
        expectedValue: null,
        limitValue: 1,
        reason: "禁止开仓：未填写止损条件或退出条件。",
      });
    }
    if (requestedAmount > accountInput.cashBalance) {
      add({
        code: "CASH_INSUFFICIENT",
        currentValue: accountInput.cashBalance,
        expectedValue: accountInput.cashBalance - requestedAmount,
        limitValue: 0,
        reason: "计划金额超过账户现金，系统禁止融资买入。",
      });
    }
    const projectedPosition = projected.positions.find((position) => position.symbol === signal.symbol)!;
    const currentPosition = current.positions.find((position) => position.symbol === signal.symbol);
    if (instrument.assetType === "LEVERAGED_ETF") {
      if (projectedPosition.positionPercent > (limits.LEVERAGED_ETF_SINGLE_MAX ?? 5)) {
        add({
          code: "LEVERAGED_ETF_SINGLE_MAX",
          currentValue: currentPosition?.positionPercent ?? 0,
          expectedValue: projectedPosition.positionPercent,
          limitValue: limits.LEVERAGED_ETF_SINGLE_MAX ?? 5,
          reason: `买入后 ${signal.symbol} 单只杠杆 ETF 仓位超过上限。`,
        });
      }
      if (projected.leveragedEtfPercent > (limits.LEVERAGED_ETF_TOTAL_MAX ?? 10)) {
        add({
          code: "LEVERAGED_ETF_TOTAL_MAX",
          currentValue: current.leveragedEtfPercent,
          expectedValue: projected.leveragedEtfPercent,
          limitValue: limits.LEVERAGED_ETF_TOTAL_MAX ?? 10,
          reason: "买入后杠杆 ETF 总仓位超过 10% 红线。",
        });
      }
    }
    if (
      instrument.assetType === "STOCK" &&
      projectedPosition.positionPercent > (limits.SINGLE_STOCK_MAX ?? 15)
    ) {
      add({
        code: "SINGLE_STOCK_MAX",
        currentValue: currentPosition?.positionPercent ?? 0,
        expectedValue: projectedPosition.positionPercent,
        limitValue: limits.SINGLE_STOCK_MAX ?? 15,
        reason: "买入后单只普通个股仓位超过 15% 上限。",
      });
    }
    if (instrument.theme === "STORAGE" && projected.storageThemePercent > (limits.STORAGE_THEME_MAX ?? 15)) {
      add({
        code: "STORAGE_THEME_MAX",
        currentValue: current.storageThemePercent,
        expectedValue: projected.storageThemePercent,
        limitValue: limits.STORAGE_THEME_MAX ?? 15,
        reason: "买入后存储主题仓位超过 15% 上限。",
      });
    }
    const themePercent = (positionsInput: RiskPositionInput[]) =>
      positionsInput
        .filter((position) => position.theme === instrument.theme)
        .reduce((sum, position) => sum + position.quantity * position.currentPrice, 0) /
      accountInput.totalEquity *
      100;
    const currentTheme = themePercent(currentPositions);
    const expectedTheme = themePercent(projectedPositions);
    if (instrument.theme && expectedTheme > (limits.THEME_MAX ?? 20)) {
      add({
        code: "THEME_MAX",
        currentValue: currentTheme,
        expectedValue: expectedTheme,
        limitValue: limits.THEME_MAX ?? 20,
        reason: `买入后 ${instrument.theme} 主题仓位超过 20% 上限。`,
      });
    }
    if (
      current.floatingLossToRealizedProfitPercent >=
      (limits.ANNUAL_PROFIT_PROTECTION ?? 50) * 0.9
    ) {
      add({
        code: "ANNUAL_PROFIT_PROTECTION",
        currentValue: current.floatingLossToRealizedProfitPercent,
        expectedValue: projected.floatingLossToRealizedProfitPercent,
        limitValue: limits.ANNUAL_PROFIT_PROTECTION ?? 50,
        reason: "当前已触发或接近年度利润保护线，禁止新增高风险仓位。",
      });
    }
    if (currentPosition?.riskLevel === "DANGER") {
      add({
        code: "HIGH_RISK_ADD_POSITION_BLOCKED",
        currentValue: currentPosition.positionPercent,
        expectedValue: projectedPosition.positionPercent,
        limitValue: currentPosition.positionPercent,
        reason: `${signal.symbol} 已属于禁止补仓的高风险持仓。`,
      });
    }
    const status = violations.length > 0 ? "RISK_REJECTED" : "RISK_APPROVED";
    return this.updateReview(signal.id, account.id, status, violations);
  }

  async updateStatus(id: string, dto: UpdateSignalStatusDto) {
    const signal = await this.prisma.strategySignal.findUnique({ where: { id } });
    if (!signal) throw new NotFoundException("策略信号不存在");
    if (dto.status === "PAPER_EXECUTED" && signal.status !== "RISK_APPROVED") {
      throw new BadRequestException("只有通过风控的信号可以标记为模拟执行");
    }
    const updated = await this.prisma.strategySignal.update({
      where: { id },
      data: { status: dto.status, reviewedAt: new Date() },
      include: { account: { select: { id: true, name: true } }, strategy: true },
    });
    return this.serialize(updated);
  }

  private async updateReview(
    id: string,
    accountId: string,
    status: string,
    violations: RiskViolation[],
    message?: string,
  ) {
    const updated = await this.prisma.strategySignal.update({
      where: { id },
      data: {
        accountId,
        status,
        reviewedAt: new Date(),
        rejectionReason:
          status === "RISK_REJECTED" ? violations.map((item) => item.reason).join("；") : null,
        riskResultJson: JSON.stringify({
          approved: status === "RISK_APPROVED",
          message: message ?? (violations.length > 0 ? "信号触发风控规则，已拒绝。" : "信号通过风控审查。"),
          violations,
        }),
      },
      include: { account: { select: { id: true, name: true } }, strategy: true },
    });
    return this.serialize(updated);
  }

  private serialize<T extends Prisma.StrategySignalGetPayload<Record<string, never>>>(signal: T) {
    return {
      ...signal,
      referencePrice: signal.referencePrice ? toNumber(signal.referencePrice) : null,
      requestedAmount: signal.requestedAmount ? toNumber(signal.requestedAmount) : null,
      requestedQuantity: signal.requestedQuantity ? toNumber(signal.requestedQuantity) : null,
      riskResult: signal.riskResultJson ? JSON.parse(signal.riskResultJson) : null,
    };
  }
}
