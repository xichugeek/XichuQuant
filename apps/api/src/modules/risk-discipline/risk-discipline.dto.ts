import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ScaleTrancheDto {
  @Type(() => Number) @IsNumber() @Min(0.000001) price!: number;
  @Type(() => Number) @IsNumber() @Min(0.000001) quantity!: number;
}

export class CreatePredefinedScalePlanDto {
  @IsString() @MinLength(1) brokerAccountId!: string;
  @IsString() @MinLength(1) symbol!: string;
  @Type(() => Number) @IsInt() @Min(1) version!: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ScaleTrancheDto)
  tranches!: ScaleTrancheDto[];
  @Type(() => Number) @IsNumber() @Min(0.000001) maxTotalQuantity!: number;
  @Type(() => Number) @IsNumber() @Min(0.0001) @Max(100) maxPrincipalPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0.000001) finalStopPrice!: number;
  @Type(() => Number) @IsNumber() @Min(0.0001) @Max(100) maxAccountRiskPct!: number;
  @IsBoolean() allowOvernight!: boolean;
  @IsString() @MinLength(2) createdBy!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) approvalChain!: string[];
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsString() @MinLength(8) @MaxLength(120) confirmationText!: string;
}

export class RecordRiskDisciplineOverrideDto {
  @IsString() @MinLength(1) targetType!: string;
  @IsString() @MinLength(1) targetId!: string;
  @IsString() @MinLength(1) ruleCode!: string;
  @IsObject() oldValue!: Record<string, unknown>;
  @IsObject() newValue!: Record<string, unknown>;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @IsString() @MinLength(2) operatorId!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) approvalChain!: string[];
}

export class CreatePositionIncidentDto {
  @IsOptional() @IsString() brokerAccountId?: string;
  @IsOptional() @IsString() localAccountId?: string;
  @IsString() @MinLength(5) @MaxLength(200) title!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) symbols!: string[];
  @IsOptional() @IsString() riskTheme?: string;
  @IsISO8601() openedAt!: string;
  @IsOptional() @IsISO8601() firstViolationAt?: string;
  @IsOptional() @IsISO8601() closedAt?: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
}
