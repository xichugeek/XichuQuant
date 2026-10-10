import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateInstrumentDto, UpdateInstrumentDto } from "./instrument.dto";

@Injectable()
export class InstrumentService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const instruments = await this.prisma.instrument.findMany({ orderBy: { symbol: "asc" } });
    return instruments.map((instrument) => this.toView(instrument));
  }

  async findOne(idOrSymbol: string) {
    const instrument = await this.prisma.instrument.findFirst({
      where: { OR: [{ id: idOrSymbol }, { symbol: idOrSymbol.toUpperCase() }] },
    });
    if (!instrument) throw new NotFoundException("标的不存在");
    return this.toView(instrument);
  }

  async create(dto: CreateInstrumentDto) {
    const symbol = dto.symbol.trim().toUpperCase();
    const exists = await this.prisma.instrument.findUnique({ where: { symbol } });
    if (exists) throw new ConflictException("标的代码已存在");
    const instrument = await this.prisma.instrument.create({ data: { ...dto, symbol } });
    return this.toView(instrument);
  }

  async update(id: string, dto: UpdateInstrumentDto) {
    await this.findOne(id);
    const instrument = await this.prisma.instrument.update({ where: { id }, data: dto });
    return this.toView(instrument);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.instrument.delete({ where: { id } });
    return { deleted: true, id };
  }

  private toView(instrument: {
    id: string;
    symbol: string;
    name: string | null;
    market: string | null;
    assetType: string;
    category: string | null;
    theme: string | null;
    underlyingSymbol: string | null;
    riskTheme: string | null;
    sector: string | null;
    industry: string | null;
    leverageRatio: Parameters<typeof toNumber>[0];
    leverageMultiplier: Parameters<typeof toNumber>[0];
    direction: string;
    leveragedETF: boolean;
    isActive: boolean;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...instrument,
      leverageRatio: instrument.leverageRatio === null ? null : toNumber(instrument.leverageRatio),
      leverageMultiplier: toNumber(instrument.leverageMultiplier),
    };
  }
}
