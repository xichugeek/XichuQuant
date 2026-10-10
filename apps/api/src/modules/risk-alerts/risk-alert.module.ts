import { Module } from "@nestjs/common";

import { RiskAlertController } from "./risk-alert.controller";
import { RiskAlertService } from "./risk-alert.service";

@Module({
  controllers: [RiskAlertController],
  exports: [RiskAlertService],
  providers: [RiskAlertService],
})
export class RiskAlertModule {}
