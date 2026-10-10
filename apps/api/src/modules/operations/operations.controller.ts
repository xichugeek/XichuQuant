import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { MarkNotificationReadDto, RunDailyCycleDto } from "./operations.dto";
import { OperationsService } from "./operations.service";

@Controller("operations")
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Post("daily-cycle")
  runDailyCycle(@Body() dto: RunDailyCycleDto) {
    return this.service.runDailyCycle(dto);
  }

  @Get("calendar")
  calendar(@Query("startDate") startDate: string, @Query("endDate") endDate: string) {
    return this.service.calendarRange(startDate, endDate);
  }

  @Get("market-clock")
  marketClock() {
    return this.service.marketClock();
  }

  @Get("data-quality")
  dataQuality() {
    return this.service.dataQualityDashboard();
  }

  @Post("data-quality/refresh")
  refreshDataQuality(@Body() dto: RunDailyCycleDto) {
    return this.service.refreshDataQuality(dto.marketDate, dto.providerCode);
  }

  @Get("tasks")
  tasks(@Query("status") status?: string, @Query("taskType") taskType?: string) {
    return this.service.tasks(status, taskType);
  }

  @Post("tasks/:id/retry")
  retryTask(@Param("id") id: string) {
    return this.service.retryTask(id);
  }

  @Get("notifications")
  notifications(@Query("status") status?: string) {
    return this.service.notifications(status);
  }

  @Patch("notifications/read")
  markNotificationRead(@Body() dto: MarkNotificationReadDto) {
    return this.service.markNotificationRead(dto.id);
  }

  @Get("forward-observations")
  forwardObservations() {
    return this.service.forwardObservationDashboard();
  }

  @Post("forward-observations/refresh")
  refreshForwardObservations(@Body() dto: RunDailyCycleDto) {
    return this.service.refreshForwardObservations(dto.marketDate);
  }
}
