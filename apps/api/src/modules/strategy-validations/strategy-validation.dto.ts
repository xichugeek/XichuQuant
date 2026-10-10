import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class RunStrategyValidationDto {
  @IsString()
  strategyId!: string;

  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  marketDataSource?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  crossSymbols?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(0.9)
  inSampleRatio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  minimumOutOfSampleTrades?: number;

  @IsOptional()
  @IsObject()
  walkForward?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  parameterGrid?: Record<string, Array<number>>;
}

export class DecideStrategyApprovalDto {
  @IsBoolean()
  userConfirmed!: boolean;
}
