import { Module } from "@nestjs/common";

import { RiskRuleController } from "./risk-rule.controller";
import { RiskRuleService } from "./risk-rule.service";

@Module({
  controllers: [RiskRuleController],
  exports: [RiskRuleService],
  providers: [RiskRuleService],
})
export class RiskRuleModule {}
