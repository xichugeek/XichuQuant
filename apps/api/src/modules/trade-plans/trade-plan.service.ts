import { Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskService } from "../risk/risk.service";
import type { RiskLevel } from "../risk/risk.types";
import type { CreateTradePlanDto, UpdateTradePlanDto } from "./trade-plan.dto";

export type TradePlanReviewResult = {
  passed: boolean;
  level: RiskLevel;
  messages: string[];
  suggestedAction: string;
};

@Injectable()
export class TradePlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskService: RiskService,
  ) {}

  async findAll(accountId?: string) {
    const plans = await this.prisma.tradePlan.findMany({
      where: accountId ? { accountId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return plans.map((plan) => this.toView(plan));
  }

  async findOne(id: string) {
    const plan = await this.prisma.tradePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("买入计划不存在");
    return this.toView(plan);
  }

  async create(dto: CreateTradePlanDto) {
    const accountId = dto.accountId ?? (await this.prisma.account.findFirst())?.id;
    if (!accountId) throw new NotFoundException("未找到投资账户");
    const symbol = dto.symbol.trim().toUpperCase();
    const instrument = await this.prisma.instrument.findUnique({ where: { symbol } });
    if (!instrument) throw new NotFoundException("标的不存在，请先维护标的信息");
    const plan = await this.prisma.tradePlan.create({
      data: {
        ...dto,
        accountId,
        symbol,
        planType: dto.planType ?? (instrument.assetType === "LEVERAGED_ETF" ? "LEVERAGED" : "CORE"),
      },
    });
    return this.toView(plan);
  }

  async update(id: string, dto: UpdateTradePlanDto) {
    await this.ensureExists(id);
    const plan = await this.prisma.tradePlan.update({ where: { id }, data: dto });
    return this.toView(plan);
  }

  async review(id: string): Promise<TradePlanReviewResult & { planId: string }> {
    const plan = await this.ensureExists(id);
    let result: TradePlanReviewResult;

    if (!plan.stopLossCondition?.trim()) {
      result = {
        passed: false,
        level: "VIOLATION",
        messages: ["禁止开仓：未填写止损条件或退出条件。"],
        suggestedAction: "请先明确最大亏损、止损条件或退出条件。",
      };
    } else {
      const [instrument, summary, totalRule] = await Promise.all([
        this.prisma.instrument.findUnique({ where: { symbol: plan.symbol } }),
        this.riskService.getSummary(plan.accountId),
        this.prisma.riskRule.findUnique({ where: { code: "LEVERAGED_ETF_TOTAL_MAX" } }),
      ]);
      const totalLimit = totalRule ? toNumber(totalRule.limitValue) : 10;
      const projectedLeveragedPercent =
        summary.leveragedEtfPercent +
        (instrument?.assetType === "LEVERAGED_ETF"
          ? (toNumber(plan.plannedAmount) / summary.totalEquity) * 100
          : 0);

      if (instrument?.assetType === "LEVERAGED_ETF" && projectedLeveragedPercent > totalLimit) {
        result = {
          passed: false,
          level: "VIOLATION",
          messages: ["禁止开仓：该计划会继续扩大已超限的杠杆 ETF 仓位。"],
          suggestedAction: "先降低 MUU / SNXX 仓位，再重新提交审查。",
        };
      } else {
        result = {
          passed: true,
          level: "LOW",
          messages: ["允许开仓：已填写退出条件，且未新增杠杆 ETF 超限风险。"],
          suggestedAction: "按计划金额执行，并严格遵守止损条件。",
        };
      }
    }

    await this.prisma.tradePlan.update({
      where: { id },
      data: {
        reviewResult: JSON.stringify(result),
        status: result.passed ? "APPROVED" : "REJECTED",
      },
    });
    return { ...result, planId: id };
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.tradePlan.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string) {
    const plan = await this.prisma.tradePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("买入计划不存在");
    return plan;
  }

  private toView(plan: {
    id: string;
    accountId: string;
    symbol: string;
    planType: string;
    plannedAmount: Parameters<typeof toNumber>[0];
    plannedPrice: Parameters<typeof toNumber>[0];
    plannedQuantity: Parameters<typeof toNumber>[0];
    reason: string;
    maxAcceptableLoss: Parameters<typeof toNumber>[0];
    stopLossCondition: string | null;
    takeProfitCondition: string | null;
    holdingPeriod: string | null;
    allowAddPosition: boolean;
    addPositionCondition: string | null;
    status: string;
    reviewResult: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...plan,
      plannedAmount: toNumber(plan.plannedAmount),
      plannedPrice: plan.plannedPrice === null ? null : toNumber(plan.plannedPrice),
      plannedQuantity: plan.plannedQuantity === null ? null : toNumber(plan.plannedQuantity),
      maxAcceptableLoss: plan.maxAcceptableLoss === null ? null : toNumber(plan.maxAcceptableLoss),
    };
  }
}
