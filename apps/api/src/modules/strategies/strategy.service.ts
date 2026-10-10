import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { QuantEngineClient } from "../quant-engine/quant-engine.client";
import type { CreateStrategyDto, UpdateStrategyDto } from "./strategy.dto";

type ValidationResult = {
  parameters: Record<string, unknown>;
  schema: Record<string, unknown>;
  valid: boolean;
};

@Injectable()
export class StrategyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantEngine: QuantEngineClient,
  ) {}

  async list(includeDisabled = false) {
    const strategies = await this.prisma.strategy.findMany({
      where: includeDisabled ? undefined : { enabled: true },
      include: { _count: { select: { backtestRuns: true, signals: true } } },
      orderBy: [{ enabled: "desc" }, { createdAt: "asc" }],
    });
    return strategies.map((strategy) => this.serialize(strategy));
  }

  async get(id: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: { _count: { select: { backtestRuns: true, signals: true } } },
    });
    if (!strategy) throw new NotFoundException("策略不存在");
    return this.serialize(strategy);
  }

  async create(dto: CreateStrategyDto) {
    const exists = await this.prisma.strategy.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException("策略代码已存在");
    const validation = await this.quantEngine.validateStrategy<ValidationResult>({
      strategyType: dto.strategyType,
      parameters: dto.parameters,
    });
    const strategy = await this.prisma.strategy.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        strategyType: dto.strategyType,
        symbolUniverse: JSON.stringify(dto.symbolUniverse.map((symbol) => symbol.toUpperCase())),
        timeframe: dto.timeframe ?? "1D",
        parameters: JSON.stringify(validation.parameters),
        parameterSchema: JSON.stringify(validation.schema),
        initialCapital: dto.initialCapital,
        commissionRate: dto.commissionRate,
        slippageRate: dto.slippageRate,
        positionSizingMode: dto.positionSizingMode ?? "PERCENT_OF_EQUITY",
        maxPositionPercent: dto.maxPositionPercent,
        enabled: dto.enabled ?? true,
      },
    });
    return this.serialize(strategy);
  }

  async update(id: string, dto: UpdateStrategyDto) {
    const current = await this.prisma.strategy.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("策略不存在");
    let normalizedParameters: Record<string, unknown> | undefined;
    let parameterSchema: Record<string, unknown> | undefined;
    if (dto.parameters) {
      const validation = await this.quantEngine.validateStrategy<ValidationResult>({
        strategyType: current.strategyType,
        parameters: dto.parameters,
      });
      normalizedParameters = validation.parameters;
      parameterSchema = validation.schema;
    }
    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        parameters: normalizedParameters ? JSON.stringify(normalizedParameters) : undefined,
        parameterSchema: parameterSchema ? JSON.stringify(parameterSchema) : undefined,
        symbolUniverse: dto.symbolUniverse
          ? JSON.stringify(dto.symbolUniverse.map((symbol) => symbol.toUpperCase()))
          : undefined,
        initialCapital: dto.initialCapital,
        commissionRate: dto.commissionRate,
        slippageRate: dto.slippageRate,
        maxPositionPercent: dto.maxPositionPercent,
        enabled: dto.enabled,
        version: dto.parameters ? { increment: 1 } : undefined,
      },
    });
    return this.serialize(strategy);
  }

  private serialize<
    T extends Prisma.StrategyGetPayload<Record<string, never>> & { _count?: unknown },
  >(strategy: T) {
    return {
      ...strategy,
      commissionRate: toNumber(strategy.commissionRate),
      initialCapital: toNumber(strategy.initialCapital),
      maxPositionPercent: toNumber(strategy.maxPositionPercent),
      parameterSchema: strategy.parameterSchema ? JSON.parse(strategy.parameterSchema) : null,
      parameters: JSON.parse(strategy.parameters),
      slippageRate: toNumber(strategy.slippageRate),
      symbolUniverse: JSON.parse(strategy.symbolUniverse),
    };
  }
}
