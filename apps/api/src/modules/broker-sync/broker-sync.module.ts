import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { BrokerConnectorClient } from "./broker-connector.client";
import { BrokerSyncController } from "./broker-sync.controller";
import { BrokerSyncService } from "./broker-sync.service";

@Module({
  controllers: [BrokerSyncController],
  exports: [BrokerConnectorClient, BrokerSyncService],
  imports: [RiskModule],
  providers: [BrokerConnectorClient, BrokerSyncService],
})
export class BrokerSyncModule {}
