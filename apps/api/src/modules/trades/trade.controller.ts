import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CreateTradeDto, UpdateTradeDto } from "./trade.dto";
import { TradeService } from "./trade.service";

@Controller("trades")
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Get()
  findAll(@Query("accountId") accountId?: string) {
    return this.tradeService.findAll(accountId);
  }

  @Post()
  create(@Body() dto: CreateTradeDto) {
    return this.tradeService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTradeDto) {
    return this.tradeService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.tradeService.remove(id);
  }
}
