import { Module } from "@nestjs/common";

import { MarketDataController } from "./market-data.controller";
import { MarketDataParserService } from "./market-data-parser.service";
import { MarketDataProviderRegistry } from "./market-data-provider";
import { MarketDataService } from "./market-data.service";
import { MarketDataSyncService } from "./market-data-sync.service";
import { UsMarketCalendarService } from "./us-market-calendar.service";

@Module({
  controllers: [MarketDataController],
  exports: [MarketDataService, MarketDataSyncService, UsMarketCalendarService],
  providers: [
    MarketDataParserService,
    MarketDataProviderRegistry,
    MarketDataService,
    MarketDataSyncService,
    UsMarketCalendarService,
  ],
})
export class MarketDataModule {}
