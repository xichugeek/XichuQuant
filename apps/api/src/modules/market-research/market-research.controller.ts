import { Body, Controller, Get, Post } from "@nestjs/common";

import { EvaluateMarketResearchDto } from "./market-research.dto";
import { MarketResearchService } from "./market-research.service";

@Controller("market-research")
export class MarketResearchController {
  constructor(private readonly service: MarketResearchService) {}

  @Get("dashboard")
  dashboard() {
    return this.service.dashboard();
  }

  @Post("evaluate")
  evaluate(@Body() dto: EvaluateMarketResearchDto) {
    return this.service.evaluate(dto);
  }
}
