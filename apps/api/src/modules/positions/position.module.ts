import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { PositionController } from "./position.controller";
import { PositionService } from "./position.service";

@Module({
  controllers: [PositionController],
  exports: [PositionService],
  imports: [RiskModule],
  providers: [PositionService],
})
export class PositionModule {}
