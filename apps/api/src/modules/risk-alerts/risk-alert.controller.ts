import { Controller, Get, Param, Post, Query } from "@nestjs/common";

import { RiskAlertService } from "./risk-alert.service";

@Controller("risk/alerts")
export class RiskAlertController {
  constructor(private readonly riskAlertService: RiskAlertService) {}

  @Get()
  findAll(@Query("accountId") accountId?: string) {
    return this.riskAlertService.findAll(accountId);
  }

  @Post(":id/resolve")
  resolve(@Param("id") id: string) {
    return this.riskAlertService.resolve(id);
  }
}
