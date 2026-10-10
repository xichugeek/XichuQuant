import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";

import { CreateSignalDto, UpdateSignalStatusDto } from "./signal.dto";
import { SignalService } from "./signal.service";

@Controller("signals")
export class SignalController {
  constructor(private readonly service: SignalService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateSignalDto) {
    return this.service.create(dto);
  }

  @Post(":id/review")
  review(@Param("id") id: string) {
    return this.service.review(id);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateSignalStatusDto) {
    return this.service.updateStatus(id, dto);
  }
}
