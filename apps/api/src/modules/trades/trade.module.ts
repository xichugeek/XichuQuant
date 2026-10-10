import { Module } from "@nestjs/common";

import { TradeController } from "./trade.controller";
import { TradeService } from "./trade.service";

@Module({
  controllers: [TradeController],
  providers: [TradeService],
})
export class TradeModule {}
