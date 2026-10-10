import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { RiskService } from "../risk/risk.service";
import { CreatePositionDto, UpdatePositionDto, UpdatePriceDto } from "./position.dto";
import { PositionService } from "./position.service";

@Controller("positions")
export class PositionController {
  constructor(
    private readonly positionService: PositionService,
    private readonly riskService: RiskService,
  ) {}

  @Get()
  async findAll(@Query("accountId") accountId?: string) {
    const summary = await this.riskService.getSummary(accountId);
    return summary.positions;
  }

  @Post()
  async create(@Body() dto: CreatePositionDto) {
    const position = await this.positionService.create(dto);
    const riskSummary = await this.riskService.evaluateAndPersist(dto.accountId);
    return { position, riskSummary };
  }

  @Post("recalculate")
  recalculate(@Body() body: { accountId?: string }) {
    return this.riskService.evaluateAndPersist(body.accountId);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdatePositionDto) {
    const position = await this.positionService.update(id, dto);
    const riskSummary = await this.riskService.evaluateAndPersist(position.accountId);
    return { position, riskSummary };
  }

  @Post(":id/update-price")
  async updatePrice(@Param("id") id: string, @Body() dto: UpdatePriceDto) {
    const position = await this.positionService.updatePrice(id, dto.currentPrice);
    const riskSummary = await this.riskService.evaluateAndPersist(position.accountId);
    return { position, riskSummary };
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const result = await this.positionService.remove(id);
    const riskSummary = await this.riskService.evaluateAndPersist(result.accountId);
    return { ...result, riskSummary };
  }
}
