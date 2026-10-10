import { Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateAccountDto, UpdateAccountDto } from "./account.dto";

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const accounts = await this.prisma.account.findMany({ orderBy: { createdAt: "asc" } });
    return accounts.map((account) => this.toView(account));
  }

  async findOne(id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("账户不存在");
    return this.toView(account);
  }

  async create(dto: CreateAccountDto) {
    const account = await this.prisma.account.create({ data: dto });
    return this.toView(account);
  }

  async update(id: string, dto: UpdateAccountDto) {
    await this.findOne(id);
    const account = await this.prisma.account.update({ where: { id }, data: dto });
    return this.toView(account);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.account.delete({ where: { id } });
    return { deleted: true, id };
  }

  private toView(account: {
    id: string;
    name: string;
    broker: string | null;
    brokerAccountId: string | null;
    baseCurrency: string;
    initialCapital: Parameters<typeof toNumber>[0];
    totalEquity: Parameters<typeof toNumber>[0];
    cashBalance: Parameters<typeof toNumber>[0];
    realizedPnlYtd: Parameters<typeof toNumber>[0];
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...account,
      initialCapital: toNumber(account.initialCapital),
      totalEquity: toNumber(account.totalEquity),
      cashBalance: toNumber(account.cashBalance),
      realizedPnlYtd: toNumber(account.realizedPnlYtd),
    };
  }
}
