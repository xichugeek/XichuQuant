import { Module } from "@nestjs/common";

import { QuantEngineModule } from "../quant-engine/quant-engine.module";
import { SignalModule } from "../signals/signal.module";
import { StrategyEvidenceModule } from "../strategy-evidence/strategy-evidence.module";
import { BacktestController } from "./backtest.controller";
import { BacktestService } from "./backtest.service";

@Module({
  controllers: [BacktestController],
  imports: [QuantEngineModule, SignalModule, StrategyEvidenceModule],
  providers: [BacktestService],
})
export class BacktestModule {}
