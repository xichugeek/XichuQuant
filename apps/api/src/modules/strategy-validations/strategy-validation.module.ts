import { Module } from "@nestjs/common";

import { QuantEngineModule } from "../quant-engine/quant-engine.module";
import { RiskModule } from "../risk/risk.module";
import { StrategyEvidenceModule } from "../strategy-evidence/strategy-evidence.module";
import { StrategyValidationController } from "./strategy-validation.controller";
import { StrategyValidationService } from "./strategy-validation.service";

@Module({
  controllers: [StrategyValidationController],
  exports: [StrategyValidationService],
  imports: [QuantEngineModule, RiskModule, StrategyEvidenceModule],
  providers: [StrategyValidationService],
})
export class StrategyValidationModule {}
