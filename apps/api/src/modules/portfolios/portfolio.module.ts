import { Module } from "@nestjs/common";

import { MarketDataModule } from "../market-data/market-data.module";
import { QuantEngineModule } from "../quant-engine/quant-engine.module";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";

@Module({
  imports: [MarketDataModule, QuantEngineModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
