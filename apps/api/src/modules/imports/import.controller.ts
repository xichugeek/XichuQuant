import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { PreviewImportDto, ResolveImportRecordDto } from "./import.dto";
import { ImportService } from "./import.service";

@Controller("imports")
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get()
  findAll(@Query("accountId") accountId?: string) {
    return this.importService.findAll(accountId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.importService.findOne(id);
  }

  @Post("preview")
  preview(@Body() dto: PreviewImportDto) {
    return this.importService.preview(dto);
  }

  @Patch(":batchId/records/:recordId")
  resolveRecord(
    @Param("batchId") batchId: string,
    @Param("recordId") recordId: string,
    @Body() dto: ResolveImportRecordDto,
  ) {
    return this.importService.resolveRecord(batchId, recordId, dto);
  }

  @Post(":id/confirm")
  confirm(@Param("id") id: string) {
    return this.importService.confirm(id);
  }

  @Post(":id/rollback")
  rollback(@Param("id") id: string) {
    return this.importService.rollback(id);
  }
}
