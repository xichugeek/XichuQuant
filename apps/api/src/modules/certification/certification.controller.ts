import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { RecordFaultResultDto, RecordLinuxCertificationDto, RunExternalCertificationDto, RunLedgerIntegrityDto, StartSoakTestDto, StopSoakTestDto } from "./certification.dto";
import { CertificationService } from "./certification.service";

@Controller("certification")
export class CertificationController {
  constructor(private readonly service: CertificationService) {}
  @Get("dashboard") dashboard() { return this.service.dashboard(); }
  @Post("external/verify") verifyExternal(@Body() dto: RunExternalCertificationDto) { return this.service.runExternalCertification(dto); }
  @Post("linux/evidence") linuxEvidence(@Body() dto: RecordLinuxCertificationDto) { return this.service.recordLinuxCertification(dto); }
  @Post("soak/start") startSoak(@Body() dto: StartSoakTestDto) { return this.service.startSoak(dto); }
  @Post("soak/:id/sample") sample(@Param("id") id: string) { return this.service.captureSoakSample(id); }
  @Post("soak/:id/stop") stopSoak(@Param("id") id: string, @Body() dto: StopSoakTestDto) { return this.service.stopSoak(id, dto); }
  @Post("faults") fault(@Body() dto: RecordFaultResultDto) { return this.service.recordFault(dto); }
  @Post("ledger-integrity") ledger(@Body() dto: RunLedgerIntegrityDto) { return this.service.runLedgerIntegrity(dto); }
  @Post("release-bundle") releaseBundle() { return this.service.createReleaseBundle(); }
}
