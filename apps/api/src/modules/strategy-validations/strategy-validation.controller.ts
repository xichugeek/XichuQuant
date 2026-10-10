import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import {
  DecideStrategyApprovalDto,
  RunStrategyValidationDto,
} from "./strategy-validation.dto";
import { StrategyValidationService } from "./strategy-validation.service";

@Controller("strategy-validations")
export class StrategyValidationController {
  constructor(private readonly service: StrategyValidationService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post("run")
  run(@Body() dto: RunStrategyValidationDto) {
    return this.service.run(dto);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post(":id/approval")
  decide(@Param("id") id: string, @Body() dto: DecideStrategyApprovalDto) {
    return this.service.decide(id, dto);
  }
}
