import { Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class RiskAlertService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(accountId?: string) {
    const resolvedAccountId = accountId ?? (await this.prisma.account.findFirst())?.id;
    if (!resolvedAccountId) throw new NotFoundException("未找到投资账户");
    const alerts = await this.prisma.riskAlert.findMany({
      where: { accountId: resolvedAccountId },
      orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
    });
    return alerts.map((alert) => ({
      ...alert,
      currentValue: alert.currentValue === null ? null : toNumber(alert.currentValue),
      limitValue: alert.limitValue === null ? null : toNumber(alert.limitValue),
    }));
  }

  async resolve(id: string) {
    const alert = await this.prisma.riskAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException("风险报警不存在");
    const updated = await this.prisma.riskAlert.update({
      where: { id },
      data: { isResolved: true, resolvedAt: new Date() },
    });
    return {
      ...updated,
      currentValue: updated.currentValue === null ? null : toNumber(updated.currentValue),
      limitValue: updated.limitValue === null ? null : toNumber(updated.limitValue),
    };
  }
}
