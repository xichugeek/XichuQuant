import { Module } from "@nestjs/common";

import { BrokerSyncModule } from "../broker-sync/broker-sync.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { RiskModule } from "../risk/risk.module";
import { BrokerPaperController } from "./broker-paper.controller";
import { BrokerPaperService } from "./broker-paper.service";
import { PaperBrokerConnectorClient } from "./paper-broker-connector.client";

@Module({
  controllers: [BrokerPaperController],
  exports: [BrokerPaperService, PaperBrokerConnectorClient],
  imports: [BrokerSyncModule, MarketDataModule, RiskModule],
  providers: [BrokerPaperService, PaperBrokerConnectorClient],
})
export class BrokerPaperModule {}
