import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CreateAccountDto, CreateEquitySnapshotDto, UpdateAccountDto } from "./account.dto";
import { AccountPerformanceService } from "./account-performance.service";
import { AccountService } from "./account.service";

@Controller("accounts")
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly performanceService: AccountPerformanceService,
  ) {}

  @Get()
  findAll() {
    return this.accountService.findAll();
  }

  @Get("current-paper/performance")
  getCurrentPaperPerformance(@Query("period") period?: string) {
    return this.performanceService.getCurrentPaperPerformance(period);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.accountService.findOne(id);
  }

  @Get(":id/performance")
  getPerformance(@Param("id") id: string, @Query("period") period?: string) {
    return this.performanceService.getPerformance(id, period);
  }

  @Post(":id/equity-snapshots")
  addEquitySnapshot(@Param("id") id: string, @Body() dto: CreateEquitySnapshotDto) {
    return this.performanceService.addSnapshot(id, dto);
  }

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAccountDto) {
    return this.accountService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.accountService.remove(id);
  }
}
