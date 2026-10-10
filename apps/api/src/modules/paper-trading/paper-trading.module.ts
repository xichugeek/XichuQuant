import { Module } from "@nestjs/common";

import { QuantEngineModule } from "../quant-engine/quant-engine.module";
import { RiskModule } from "../risk/risk.module";
import { StrategyEvidenceModule } from "../strategy-evidence/strategy-evidence.module";
import { PaperTradingController } from "./paper-trading.controller";
import { PaperTradingService } from "./paper-trading.service";

@Module({
  controllers: [PaperTradingController],
  exports: [PaperTradingService],
  imports: [QuantEngineModule, RiskModule, StrategyEvidenceModule],
  providers: [PaperTradingService],
})
export class PaperTradingModule {}
