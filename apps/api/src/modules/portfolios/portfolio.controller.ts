import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import {
  AddPortfolioStrategyDto,
  CreatePortfolioDto,
  PortfolioStatusDto,
  PortfolioStrategyStatusDto,
  PreviewPortfolioRunDto,
  UpdatePortfolioAllocationDto,
  UpdatePortfolioRiskDto,
} from "./portfolio.dto";
import { PortfolioService } from "./portfolio.service";

@Controller("portfolios")
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get("dashboard")
  dashboard(@Query("portfolioId") portfolioId?: string) {
    return this.service.dashboard(portfolioId);
  }

  @Post()
  create(@Body() dto: CreatePortfolioDto) {
    return this.service.create(dto);
  }

  @Post(":id/strategies")
  addStrategy(@Param("id") id: string, @Body() dto: AddPortfolioStrategyDto) {
    return this.service.addStrategy(id, dto);
  }

  @Post(":id/strategies/:memberId/status")
  updateStrategyStatus(
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Body() dto: PortfolioStrategyStatusDto,
  ) {
    return this.service.updateStrategyStatus(id, memberId, dto);
  }

  @Patch(":id/allocation")
  updateAllocation(@Param("id") id: string, @Body() dto: UpdatePortfolioAllocationDto) {
    return this.service.updateAllocation(id, dto);
  }

  @Patch(":id/risk-rules")
  updateRiskRules(@Param("id") id: string, @Body() dto: UpdatePortfolioRiskDto) {
    return this.service.updateRiskRules(id, dto);
  }

  @Post(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: PortfolioStatusDto) {
    return this.service.updateStatus(id, dto);
  }

  @Post(":id/rebalance")
  rebalance(@Param("id") id: string, @Body() dto: PreviewPortfolioRunDto) {
    return this.service.previewOrExecute(id, dto);
  }

  @Post("orders/process")
  processOrders() {
    return this.service.processPendingOrders();
  }

  @Post(":id/snapshot")
  snapshot(@Param("id") id: string, @Body() body: { snapshotDate?: string }) {
    return this.service.refreshSnapshot(id, body.snapshotDate);
  }

  @Get(":id/performance")
  performance(@Param("id") id: string) {
    return this.service.performance(id);
  }

  @Post(":id/analyze")
  analyze(@Param("id") id: string) {
    return this.service.analyze(id);
  }
}
