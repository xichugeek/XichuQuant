import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";

import { RiskService } from "./risk.service";
import type { RiskSummary } from "./risk.types";

class EvaluateRiskDto {
  @IsOptional()
  @IsString()
  accountId?: string;
}

@Controller("risk")
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Get("summary")
  getSummary(@Query("accountId") accountId?: string): Promise<RiskSummary> {
    return this.riskService.getSummary(accountId);
  }

  @Post("evaluate")
  evaluate(@Body() body: EvaluateRiskDto): Promise<RiskSummary> {
    return this.riskService.evaluateAndPersist(body.accountId);
  }
}
