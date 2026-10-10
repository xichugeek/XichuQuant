import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class RunExternalCertificationDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsString() @MinLength(10) @MaxLength(100) confirmationText!: string;
  @IsBoolean() explicitOrderAuthorization!: boolean;
}

export class StartSoakTestDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsString() @MinLength(10) @MaxLength(100) confirmationText!: string;
  @Type(() => Number) @IsInt() @Min(72) @Max(168) targetHours = 72;
  @IsOptional() @IsString() @MaxLength(120) environment?: string;
}

export class StopSoakTestDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsString() @MinLength(10) @MaxLength(100) confirmationText!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class RunLedgerIntegrityDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsIn(["MANUAL", "POST_FAULT", "POST_RECONCILIATION"]) source!: string;
}

export class RecordFaultResultDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsString() @MinLength(3) scenario!: string;
  @IsIn(["BLOCKED", "FAILED", "PASSED"]) status!: string;
  @IsString() @MinLength(5) expectedBehavior!: string;
  @IsOptional() @IsString() actualBehavior?: string;
  @IsOptional() @IsString() blockedReason?: string;
  @Type(() => Number) @IsInt() @Min(0) duplicateOrders = 0;
  @IsBoolean() ledgerPolluted = false;
  @IsBoolean() notificationTriggered = false;
  @IsBoolean() recovered = false;
  @IsBoolean() manualActionRequired = false;
}

export class RecordLinuxCertificationDto {
  @IsString() @MinLength(2) operatorId!: string;
  @IsString() @MinLength(10) @MaxLength(100) confirmationText!: string;
  @IsString() @MinLength(2) osVersion!: string;
  @IsString() @MinLength(2) dockerVersion!: string;
  @IsString() @MinLength(2) composeVersion!: string;
  @IsString() @MinLength(2) imageVersions!: string;
  @IsBoolean() containersHealthy!: boolean;
  @IsBoolean() migrationsUpToDate!: boolean;
  @IsBoolean() dataPersisted!: boolean;
  @IsBoolean() containerRestartRecovered!: boolean;
  @IsBoolean() hostRestartRecovered!: boolean;
  @IsBoolean() backupRestorePassed!: boolean;
}
