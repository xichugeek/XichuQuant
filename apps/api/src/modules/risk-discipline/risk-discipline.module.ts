import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { RiskDisciplineController } from "./risk-discipline.controller";
import { RiskDisciplineService } from "./risk-discipline.service";

@Module({
  controllers: [RiskDisciplineController],
  exports: [RiskDisciplineService],
  imports: [RiskModule],
  providers: [RiskDisciplineService],
})
export class RiskDisciplineModule {}
