import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreatePositionDto, UpdatePositionDto } from "./position.dto";

@Injectable()
export class PositionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePositionDto) {
    const instrument = await this.prisma.instrument.findUnique({
      where: { symbol: dto.symbol.trim().toUpperCase() },
    });
    if (!instrument) throw new NotFoundException("标的不存在，请先维护标的信息");
    const existing = await this.prisma.position.findUnique({
      where: {
        accountId_instrumentId: { accountId: dto.accountId, instrumentId: instrument.id },
      },
    });
    if (existing) throw new ConflictException("该账户已存在此标的持仓");
    const position = await this.prisma.position.create({
      data: {
        accountId: dto.accountId,
        instrumentId: instrument.id,
        quantity: dto.quantity,
        avgCost: dto.avgCost,
        currentPrice: dto.currentPrice,
        note: dto.note,
      },
      include: { instrument: true },
    });
    return this.toRawView(position);
  }

  async update(id: string, dto: UpdatePositionDto) {
    await this.ensureExists(id);
    const position = await this.prisma.position.update({
      where: { id },
      data: dto,
      include: { instrument: true },
    });
    return this.toRawView(position);
  }

  async remove(id: string) {
    const position = await this.ensureExists(id);
    await this.prisma.position.delete({ where: { id } });
    return { accountId: position.accountId, deleted: true, id };
  }

  async updatePrice(id: string, currentPrice: number) {
    await this.ensureExists(id);
    const position = await this.prisma.position.update({
      where: { id },
      data: { currentPrice },
      include: { instrument: true },
    });
    await this.prisma.priceSnapshot.create({
      data: { instrumentId: position.instrumentId, price: currentPrice, source: "MANUAL" },
    });
    return this.toRawView(position);
  }

  private async ensureExists(id: string) {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) throw new NotFoundException("持仓不存在");
    return position;
  }

  private toRawView(position: {
    id: string;
    accountId: string;
    quantity: Parameters<typeof toNumber>[0];
    avgCost: Parameters<typeof toNumber>[0];
    currentPrice: Parameters<typeof toNumber>[0];
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    instrument: { id: string; symbol: string; name: string | null };
  }) {
    return {
      id: position.id,
      accountId: position.accountId,
      symbol: position.instrument.symbol,
      name: position.instrument.name,
      quantity: toNumber(position.quantity),
      avgCost: toNumber(position.avgCost),
      currentPrice: toNumber(position.currentPrice),
      note: position.note,
      createdAt: position.createdAt,
      updatedAt: position.updatedAt,
    };
  }
}
