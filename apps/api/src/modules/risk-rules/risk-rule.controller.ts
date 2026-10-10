import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";

import { CreateRiskRuleDto, UpdateRiskRuleDto } from "./risk-rule.dto";
import { RiskRuleService } from "./risk-rule.service";

@Controller("risk-rules")
export class RiskRuleController {
  constructor(private readonly riskRuleService: RiskRuleService) {}

  @Get()
  findAll() {
    return this.riskRuleService.findAll();
  }

  @Post()
  create(@Body() dto: CreateRiskRuleDto) {
    return this.riskRuleService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateRiskRuleDto) {
    return this.riskRuleService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.riskRuleService.remove(id);
  }
}
