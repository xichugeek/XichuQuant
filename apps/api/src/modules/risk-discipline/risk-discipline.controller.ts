import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import {
  CreatePositionIncidentDto,
  CreatePredefinedScalePlanDto,
  RecordRiskDisciplineOverrideDto,
} from "./risk-discipline.dto";
import { RiskDisciplineService } from "./risk-discipline.service";

@Controller("risk-discipline")
export class RiskDisciplineController {
  constructor(private readonly service: RiskDisciplineService) {}

  @Get("dashboard")
  dashboard(
    @Query("accountId") accountId?: string,
    @Query("brokerAccountId") brokerAccountId?: string,
  ) {
    return this.service.dashboard(accountId, brokerAccountId);
  }

  @Get("analytics")
  analytics(
    @Query("accountId") accountId?: string,
    @Query("brokerAccountId") brokerAccountId?: string,
  ) {
    return this.service.tradeDisciplineAnalytics(accountId, brokerAccountId);
  }

  @Get("incidents")
  incidents() {
    return this.service.incidents();
  }

  @Get("incidents/:id/replay")
  replay(@Param("id") id: string) {
    return this.service.replayIncident(id);
  }

  @Post("incidents")
  createIncident(@Body() dto: CreatePositionIncidentDto) {
    return this.service.createIncident(dto);
  }

  @Post("scale-plans")
  createScalePlan(@Body() dto: CreatePredefinedScalePlanDto) {
    return this.service.createScalePlan(dto);
  }

  @Post("overrides")
  recordOverride(@Body() dto: RecordRiskDisciplineOverrideDto) {
    return this.service.recordSoftOverride(dto);
  }
}
