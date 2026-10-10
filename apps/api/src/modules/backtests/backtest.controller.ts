import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";

import { RunBacktestDto } from "./backtest.dto";
import { BacktestService } from "./backtest.service";

@Controller("backtests")
export class BacktestController {
  constructor(private readonly service: BacktestService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post("run")
  run(@Body() dto: RunBacktestDto) {
    return this.service.run(dto);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }

  @Get(":id/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="backtest-trades.csv"')
  exportTrades(@Param("id") id: string) {
    return this.service.exportTrades(id);
  }
}
