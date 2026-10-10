import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { SignalController } from "./signal.controller";
import { SignalService } from "./signal.service";

@Module({
  controllers: [SignalController],
  exports: [SignalService],
  imports: [RiskModule],
  providers: [SignalService],
})
export class SignalModule {}
