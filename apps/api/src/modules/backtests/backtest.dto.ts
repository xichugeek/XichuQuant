import { Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from "class-validator";

export class RunBacktestDto {
  @IsString()
  strategyId!: string;

  @IsString()
  symbol!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  marketDataSource?: string;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @IsOptional()
  @IsIn(["PERCENT_NOTIONAL", "IBKR_US_EQUITY_TIERED_BASE"])
  commissionModel?: "PERCENT_NOTIONAL" | "IBKR_US_EQUITY_TIERED_BASE";

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
  @IsInt()
  randomSeed?: number;

  @IsOptional()
  @IsIn(["ADJUSTED", "RAW_WITH_ACTIONS"])
  priceMode?: "ADJUSTED" | "RAW_WITH_ACTIONS";
}
