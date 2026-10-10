import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import {
  CreatePaperAccountDto,
  CreateStrategyDeploymentDto,
  KillSwitchDto,
  RunPaperDeploymentDto,
  UpdateDeploymentStatusDto,
} from "./paper-trading.dto";
import { PaperTradingService } from "./paper-trading.service";

@Controller("paper-trading")
export class PaperTradingController {
  constructor(private readonly service: PaperTradingService) {}

  @Get("dashboard")
  dashboard(@Query("accountId") accountId?: string) {
    return this.service.dashboard(accountId);
  }

  @Post("accounts")
  createAccount(@Body() dto: CreatePaperAccountDto) {
    return this.service.createAccount(dto);
  }

  @Post("deployments")
  createDeployment(@Body() dto: CreateStrategyDeploymentDto) {
    return this.service.createDeployment(dto);
  }

  @Post("deployments/:id/status")
  updateDeploymentStatus(@Param("id") id: string, @Body() dto: UpdateDeploymentStatusDto) {
    return this.service.updateDeploymentStatus(id, dto);
  }

  @Post("deployments/:id/run")
  runDeployment(@Param("id") id: string, @Body() dto: RunPaperDeploymentDto) {
    return this.service.runDeployment(id, dto);
  }

  @Post("orders/process")
  processOrders() {
    return this.service.processPendingOrders();
  }

  @Post("kill-switch")
  killSwitch(@Body() dto: KillSwitchDto) {
    return this.service.setKillSwitch(dto);
  }

  @Get("review")
  review(@Query("deploymentId") deploymentId?: string) {
    return this.service.review(deploymentId);
  }
}
