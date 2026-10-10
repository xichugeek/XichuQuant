import { Module } from "@nestjs/common";

import { AccountController } from "./account.controller";
import { AccountPerformanceService } from "./account-performance.service";
import { AccountService } from "./account.service";
import { RiskModule } from "../risk/risk.module";

@Module({
  controllers: [AccountController],
  exports: [AccountPerformanceService, AccountService],
  imports: [RiskModule],
  providers: [AccountPerformanceService, AccountService],
})
export class AccountModule {}
