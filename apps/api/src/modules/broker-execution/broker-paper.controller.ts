import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";

import {
  CancelBrokerPaperOrderDto,
  ConfirmBrokerPaperReplyDto,
  ConfigureBrokerPaperExecutionDto,
  CreateBrokerOrderProposalDto,
  DecideBrokerOrderProposalDto,
  ModifyBrokerPaperOrderDto,
  RecordBackupRecoveryDto,
  SubmitBrokerPaperOrderDto,
  UpdateExecutionKillSwitchDto,
} from "./broker-paper.dto";
import { BrokerPaperService } from "./broker-paper.service";

@Controller("paper-execution")
export class BrokerPaperController {
  constructor(private readonly service: BrokerPaperService) {}

  @Get("dashboard")
  dashboard() {
    return this.service.dashboard();
  }

  @Get("monitor")
  monitor() {
    return this.service.monitor();
  }

  @Patch("configuration")
  configure(@Body() dto: ConfigureBrokerPaperExecutionDto) {
    return this.service.configurePaperExecution(dto);
  }

  @Post("proposals")
  createProposal(@Body() dto: CreateBrokerOrderProposalDto) {
    return this.service.createProposal(dto);
  }

  @Post("proposals/:id/decision")
  decideProposal(@Param("id") id: string, @Body() dto: DecideBrokerOrderProposalDto) {
    return this.service.decideProposal(id, dto);
  }

  @Post("proposals/:id/submit")
  submitProposal(@Param("id") id: string, @Body() dto: SubmitBrokerPaperOrderDto) {
    return this.service.submitProposal(id, dto);
  }

  @Post("orders/:id/confirm-broker-reply")
  confirmBrokerReply(@Param("id") id: string, @Body() dto: ConfirmBrokerPaperReplyDto) {
    return this.service.confirmBrokerReply(id, dto);
  }

  @Patch("orders/:id")
  modifyOrder(@Param("id") id: string, @Body() dto: ModifyBrokerPaperOrderDto) {
    return this.service.modifyOrder(id, dto);
  }

  @Post("orders/:id/cancel")
  cancelOrder(@Param("id") id: string, @Body() dto: CancelBrokerPaperOrderDto) {
    return this.service.cancelOrder(id, dto);
  }

  @Post("sync")
  syncPaperOrders() {
    return this.service.syncPaperOrders();
  }

  @Post("recover")
  recover() {
    return this.service.recover();
  }

  @Patch("kill-switch")
  updateKillSwitch(@Body() dto: UpdateExecutionKillSwitchDto) {
    return this.service.updateKillSwitch(dto);
  }

  @Post("backup-runs")
  recordBackupRecovery(@Body() dto: RecordBackupRecoveryDto) {
    return this.service.recordBackupRecovery(dto);
  }
}
