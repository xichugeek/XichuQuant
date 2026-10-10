import { Module } from "@nestjs/common";

import { MarketDataModule } from "../market-data/market-data.module";
import { BrokerSyncModule } from "../broker-sync/broker-sync.module";
import { PaperTradingModule } from "../paper-trading/paper-trading.module";
import { PortfolioModule } from "../portfolios/portfolio.module";
import { OperationsController } from "./operations.controller";
import { OperationsService } from "./operations.service";

@Module({
  controllers: [OperationsController],
  imports: [BrokerSyncModule, MarketDataModule, PaperTradingModule, PortfolioModule],
  providers: [OperationsService],
})
export class OperationsModule {}
