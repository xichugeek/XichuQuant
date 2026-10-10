import { Body, Controller, Get, Post, Query } from "@nestjs/common";

import {
  CaptureIbkrTopOfBookDto,
  ImportStrategyEvidenceDto,
  SyncFredFinancingDto,
  SyncFredMarketFactorsDto,
  SyncSecFundamentalsDto,
} from "./strategy-evidence.dto";
import { StrategyEvidenceService } from "./strategy-evidence.service";

@Controller("strategy-evidence")
export class StrategyEvidenceController {
  constructor(private readonly service: StrategyEvidenceService) {}

  @Get("dashboard")
  dashboard(@Query("symbol") symbol?: string) {
    return this.service.dashboard(symbol);
  }

  @Post("observations")
  importObservation(@Body() dto: ImportStrategyEvidenceDto) {
    return this.service.importObservation(dto);
  }

  @Post("sync/ibkr-top-of-book")
  captureIbkrTopOfBook(@Body() dto: CaptureIbkrTopOfBookDto) {
    return this.service.captureIbkrTopOfBook(dto);
  }

  @Post("sync/fred")
  syncFred(@Body() dto: SyncFredFinancingDto) {
    return this.service.syncFred(dto);
  }

  @Post("sync/fred-market-factors")
  syncFredMarketFactors(@Body() dto: SyncFredMarketFactorsDto) {
    return this.service.syncFredMarketFactors(dto);
  }

  @Post("sync/sec")
  syncSec(@Body() dto: SyncSecFundamentalsDto) {
    return this.service.syncSec(dto);
  }
}
