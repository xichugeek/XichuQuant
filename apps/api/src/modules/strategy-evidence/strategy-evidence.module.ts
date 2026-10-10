import { Module } from "@nestjs/common";

import { BrokerSyncModule } from "../broker-sync/broker-sync.module";
import { StrategyEvidenceController } from "./strategy-evidence.controller";
import { StrategyEvidenceService } from "./strategy-evidence.service";

@Module({
  controllers: [StrategyEvidenceController],
  exports: [StrategyEvidenceService],
  imports: [BrokerSyncModule],
  providers: [StrategyEvidenceService],
})
export class StrategyEvidenceModule {}
