import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CreateTradePlanDto, UpdateTradePlanDto } from "./trade-plan.dto";
import { TradePlanService } from "./trade-plan.service";

@Controller("trade-plans")
export class TradePlanController {
  constructor(private readonly tradePlanService: TradePlanService) {}

  @Get()
  findAll(@Query("accountId") accountId?: string) {
    return this.tradePlanService.findAll(accountId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.tradePlanService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTradePlanDto) {
    return this.tradePlanService.create(dto);
  }

  @Post(":id/review")
  review(@Param("id") id: string) {
    return this.tradePlanService.review(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTradePlanDto) {
    return this.tradePlanService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.tradePlanService.remove(id);
  }
}
