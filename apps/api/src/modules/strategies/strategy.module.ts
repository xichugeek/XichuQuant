import { Module } from "@nestjs/common";

import { QuantEngineModule } from "../quant-engine/quant-engine.module";
import { StrategyController } from "./strategy.controller";
import { StrategyService } from "./strategy.service";

@Module({
  controllers: [StrategyController],
  imports: [QuantEngineModule],
  providers: [StrategyService],
})
export class StrategyModule {}
