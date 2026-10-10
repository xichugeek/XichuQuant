import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateRiskRuleDto, UpdateRiskRuleDto } from "./risk-rule.dto";

@Injectable()
export class RiskRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const rules = await this.prisma.riskRule.findMany({ orderBy: { createdAt: "asc" } });
    return rules.map((rule) => ({ ...rule, limitValue: toNumber(rule.limitValue) }));
  }

  async create(dto: CreateRiskRuleDto) {
    const exists = await this.prisma.riskRule.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException("风控规则代码已存在");
    const rule = await this.prisma.riskRule.create({ data: dto });
    return { ...rule, limitValue: toNumber(rule.limitValue) };
  }

  async update(id: string, dto: UpdateRiskRuleDto) {
    await this.ensureExists(id);
    const rule = await this.prisma.riskRule.update({ where: { id }, data: dto });
    return { ...rule, limitValue: toNumber(rule.limitValue) };
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.riskRule.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string) {
    const rule = await this.prisma.riskRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("风控规则不存在");
    return rule;
  }
}
