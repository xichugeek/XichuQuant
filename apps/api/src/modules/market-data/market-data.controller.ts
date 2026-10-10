import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { PreviewMarketDataDto } from "./market-data.dto";
import { MarketDataService } from "./market-data.service";
import { MarketDataSyncService } from "./market-data-sync.service";

@Controller("market-data")
export class MarketDataController {
  constructor(
    private readonly service: MarketDataService,
    private readonly syncService: MarketDataSyncService,
  ) {}

  @Get("providers")
  providers() {
    return this.service.providers();
  }

  @Get("providers/status")
  providerStatus() {
    return this.syncService.providerStatus();
  }

  @Get("summary")
  summary() {
    return this.service.summary();
  }

  @Get("daily")
  daily(
    @Query("symbol") symbol: string,
    @Query("source") source?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.service.daily(symbol, source, startDate, endDate);
  }

  @Post("imports/preview")
  preview(@Body() dto: PreviewMarketDataDto) {
    return this.service.preview(dto);
  }

  @Post("imports/:id/confirm")
  confirm(@Param("id") id: string) {
    return this.service.confirm(id);
  }

  @Get("imports/:id")
  batch(@Param("id") id: string) {
    return this.service.batch(id);
  }
}
