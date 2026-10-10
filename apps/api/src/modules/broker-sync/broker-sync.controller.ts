import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import {
  CreateShadowIntentDto,
  ReconciliationDecisionDto,
  RunBrokerSyncDto,
  RunReconciliationDto,
  UpdateBrokerSettingsDto,
} from "./broker-sync.dto";
import { BrokerSyncService } from "./broker-sync.service";

@Controller("broker")
export class BrokerSyncController {
  constructor(private readonly service: BrokerSyncService) {}

  @Get("dashboard")
  dashboard() {
    return this.service.dashboard();
  }

  @Get("status")
  status() {
    return this.service.connectionStatus();
  }

  @Patch("settings")
  settings(@Body() dto: UpdateBrokerSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Post("sync")
  sync(@Body() dto: RunBrokerSyncDto) {
    return this.service.runSync(dto);
  }

  @Post("sync/:id/retry")
  retrySync(@Param("id") id: string) {
    return this.service.retrySync(id);
  }

  @Post("sync/:id/cancel")
  cancelSync(@Param("id") id: string) {
    return this.service.cancelPendingSync(id);
  }

  @Post("reconciliation")
  reconcile(@Body() dto: RunReconciliationDto) {
    return this.service.reconcile(dto);
  }

  @Post("reconciliation/differences/:id/decision")
  decide(@Param("id") id: string, @Body() dto: ReconciliationDecisionDto) {
    return this.service.decideDifference(id, dto);
  }

  @Post("shadow/intents")
  shadowIntent(@Body() dto: CreateShadowIntentDto) {
    return this.service.createShadowIntent(dto);
  }

  @Post("shadow/fills/process")
  shadowFills() {
    return this.service.processShadowFills();
  }

  @Get("readiness")
  readiness() {
    return this.service.readiness();
  }

  @Get("services")
  services(@Query("refresh") refresh?: string) {
    return this.service.serviceStatus(refresh === "true");
  }
}
