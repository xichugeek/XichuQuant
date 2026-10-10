import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class CreatePaperAccountDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(100)
  initialCapital!: number;
}

export class CreateStrategyDeploymentDto {
  @IsString()
  strategyId!: string;

  @IsString()
  paperAccountId!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  capitalAllocation!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxPositionPercent!: number;

  @IsString()
  stopLossCondition!: string;

  @IsString()
  exitCondition!: string;
}

export class UpdateDeploymentStatusDto {
  @IsIn(["START", "PAUSE", "STOP"])
  action!: "START" | "PAUSE" | "STOP";
}

export class RunPaperDeploymentDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  signalTradeDate?: string;
}

export class KillSwitchDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
