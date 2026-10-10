import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CreateStrategyDto, UpdateStrategyDto } from "./strategy.dto";
import { StrategyService } from "./strategy.service";

@Controller("strategies")
export class StrategyController {
  constructor(private readonly service: StrategyService) {}

  @Get()
  list(@Query("includeDisabled") includeDisabled?: string) {
    return this.service.list(includeDisabled === "true");
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() dto: CreateStrategyDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateStrategyDto) {
    return this.service.update(id, dto);
  }
}
