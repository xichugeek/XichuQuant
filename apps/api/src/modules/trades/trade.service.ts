import { Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateTradeDto, UpdateTradeDto } from "./trade.dto";

@Injectable()
export class TradeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(accountId?: string) {
    const trades = await this.prisma.trade.findMany({
      where: accountId ? { accountId } : undefined,
      include: { instrument: true },
      orderBy: { tradeDate: "desc" },
    });
    return trades.map((trade) => this.toView(trade));
  }

  async create(dto: CreateTradeDto) {
    const accountId = dto.accountId ?? (await this.prisma.account.findFirst())?.id;
    if (!accountId) throw new NotFoundException("未找到投资账户");
    const instrument = await this.prisma.instrument.findUnique({
      where: { symbol: dto.symbol.trim().toUpperCase() },
    });
    if (!instrument) throw new NotFoundException("标的不存在，请先维护标的信息");
    const amount = dto.amount ?? dto.quantity * dto.price;
    const trade = await this.prisma.trade.create({
      data: {
        accountId,
        instrumentId: instrument.id,
        tradeDate: new Date(dto.tradeDate),
        side: dto.side.toUpperCase(),
        quantity: dto.quantity,
        price: dto.price,
        commission: dto.commission ?? 0,
        amount,
        realizedPnl: dto.realizedPnl,
        reason: dto.reason,
        emotionTag: dto.emotionTag,
        isRuleFollowed: dto.isRuleFollowed,
        note: dto.note,
      },
      include: { instrument: true },
    });
    return this.toView(trade);
  }

  async update(id: string, dto: UpdateTradeDto) {
    await this.ensureExists(id);
    const trade = await this.prisma.trade.update({
      where: { id },
      data: dto,
      include: { instrument: true },
    });
    return this.toView(trade);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.trade.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string) {
    const trade = await this.prisma.trade.findUnique({ where: { id } });
    if (!trade) throw new NotFoundException("交易记录不存在");
    return trade;
  }

  private toView(trade: {
    id: string;
    accountId: string;
    tradeDate: Date;
    side: string;
    quantity: Parameters<typeof toNumber>[0];
    price: Parameters<typeof toNumber>[0];
    commission: Parameters<typeof toNumber>[0];
    amount: Parameters<typeof toNumber>[0];
    realizedPnl: Parameters<typeof toNumber>[0];
    reason: string | null;
    emotionTag: string | null;
    isRuleFollowed: boolean | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    instrument: { symbol: string; name: string | null };
  }) {
    return {
      id: trade.id,
      accountId: trade.accountId,
      date: trade.tradeDate.toISOString().slice(0, 10),
      tradeDate: trade.tradeDate,
      symbol: trade.instrument.symbol,
      instrumentName: trade.instrument.name,
      side: trade.side,
      quantity: toNumber(trade.quantity),
      price: toNumber(trade.price),
      commission: toNumber(trade.commission),
      amount: toNumber(trade.amount),
      realizedPnl: trade.realizedPnl === null ? null : toNumber(trade.realizedPnl),
      reason: trade.reason,
      emotion: trade.emotionTag,
      emotionTag: trade.emotionTag,
      followedRule: trade.isRuleFollowed,
      isRuleFollowed: trade.isRuleFollowed,
      note: trade.note,
      createdAt: trade.createdAt,
      updatedAt: trade.updatedAt,
    };
  }
}
