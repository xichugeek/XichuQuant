import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const strategyTypes = [
  "BuyAndHold",
  "TimeSeriesMomentum",
  "MultiHorizonTrend",
  "DualMomentumRotation",
  "CoreSatelliteMomentum",
  "FundamentalLiquidityCrowding",
] as const;

export class CreateStrategyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(strategyTypes)
  strategyType!: (typeof strategyTypes)[number];

  @IsArray()
  @IsString({ each: true })
  symbolUniverse!: string[];

  @IsOptional()
  @IsIn(["1D"])
  timeframe?: string;

  @IsObject()
  parameters!: Record<string, unknown>;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  initialCapital!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.1)
  commissionRate!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.1)
  slippageRate!: number;

  @IsOptional()
  @IsIn(["PERCENT_OF_EQUITY"])
  positionSizingMode?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(100)
  maxPositionPercent!: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbolUniverse?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  initialCapital?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.1)
  commissionRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.1)
  slippageRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(100)
  maxPositionPercent?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
