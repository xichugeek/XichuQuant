import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { TradePlanController } from "./trade-plan.controller";
import { TradePlanService } from "./trade-plan.service";

@Module({
  controllers: [TradePlanController],
  imports: [RiskModule],
  providers: [TradePlanService],
})
export class TradePlanModule {}
