import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateBrokerOrderProposalDto {
  @IsString() @MinLength(1) brokerAccountId!: string;
  @IsString() @MinLength(1) strategyId!: string;
  @IsString() @MinLength(1) strategyDeploymentId!: string;
  @IsString() @MinLength(1) strategyVersion!: string;
  @IsOptional() @IsString() portfolioId?: string;
  @IsString() @MinLength(1) symbol!: string;
  @IsString() @MinLength(1) contractId!: string;
  @IsIn(["BUY", "SELL"]) side!: "BUY" | "SELL";
  @IsIn(["LIMIT", "MARKET", "STOP", "STOP_LIMIT"])
  orderType!: "LIMIT" | "MARKET" | "STOP" | "STOP_LIMIT";
  @Type(() => Number) @IsNumber() @Min(0.000001) quantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) limitPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) stopPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) plannedStopPrice?: number;
  @IsString() @MinLength(5) @MaxLength(1000) exitCondition!: string;
  @IsBoolean() allowOvernight!: boolean;
  @IsOptional() @IsString() predefinedScalePlanId?: string;
  @IsIn(["DAY", "GTC"]) timeInForce!: "DAY" | "GTC";
  @IsBoolean() outsideRth!: boolean;
  @IsBoolean() allowPartialFill!: boolean;
  @Type(() => Number) @IsNumber() @Min(0) @Max(20) maxSlippage!: number;
  @IsISO8601() expirationTime!: string;
  @IsISO8601() signalTradeDate!: string;
  @IsOptional() @IsString() signalId?: string;
  @IsString() @MinLength(1) riskDecisionId!: string;
  @IsOptional() @IsString() portfolioRiskDecisionId?: string;
  @Type(() => Number) @IsInt() @Min(1) proposalVersion = 1;
}

export class DecideBrokerOrderProposalDto {
  @IsString() @MinLength(2) actorId!: string;
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
}

export class SubmitBrokerPaperOrderDto {
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
  @IsBoolean() isClosing!: boolean;
}

export class ConfirmBrokerPaperReplyDto {
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(100) confirmationText!: string;
}

export class ModifyBrokerPaperOrderDto {
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
  @Type(() => Number) @IsNumber() @Min(0.000001) quantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) limitPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) stopPrice?: number;
  @IsOptional() @IsBoolean() cancelStop?: boolean;
}

export class CancelBrokerPaperOrderDto {
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class UpdateExecutionKillSwitchDto {
  @IsIn([
    "LEVEL_0_NORMAL",
    "LEVEL_1_NO_NEW_ENTRY",
    "LEVEL_2_CANCEL_OPEN_ORDERS",
    "LEVEL_3_CLOSE_PAPER_POSITIONS",
    "LEVEL_4_LOCKDOWN",
  ])
  level!: string;
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class RecordBackupRecoveryDto {
  @IsIn(["BACKUP", "RESTORE_TEST", "VERIFY"])
  operation!: "BACKUP" | "RESTORE_TEST" | "VERIFY";
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(1) targetDatabase!: string;
  @IsIn(["FAILED", "RUNNING", "SUCCEEDED", "VERIFIED"])
  status!: string;
  @IsOptional() @IsString() backupReference?: string;
  @IsOptional() @IsString() verificationJson?: string;
  @IsOptional() @IsString() errorMessage?: string;
}

export class ConfigureBrokerPaperExecutionDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @MinLength(2) actorId!: string;
  @IsString() @MinLength(8) @MaxLength(80) confirmationText!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
