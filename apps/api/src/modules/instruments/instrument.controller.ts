import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";

import { CreateInstrumentDto, UpdateInstrumentDto } from "./instrument.dto";
import { InstrumentService } from "./instrument.service";

@Controller("instruments")
export class InstrumentController {
  constructor(private readonly instrumentService: InstrumentService) {}

  @Get()
  findAll() {
    return this.instrumentService.findAll();
  }

  @Get(":idOrSymbol")
  findOne(@Param("idOrSymbol") idOrSymbol: string) {
    return this.instrumentService.findOne(idOrSymbol);
  }

  @Post()
  create(@Body() dto: CreateInstrumentDto) {
    return this.instrumentService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateInstrumentDto) {
    return this.instrumentService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.instrumentService.remove(id);
  }
}
