import { IsBoolean, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTradePlanDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  planType?: string;

  @IsNumber()
  @Min(0.01)
  plannedAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedQuantity?: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAcceptableLoss?: number;

  @IsOptional()
  @IsString()
  stopLossCondition?: string;

  @IsOptional()
  @IsString()
  takeProfitCondition?: string;

  @IsOptional()
  @IsString()
  holdingPeriod?: string;

  @IsOptional()
  @IsBoolean()
  allowAddPosition?: boolean;

  @IsOptional()
  @IsString()
  addPositionCondition?: string;
}

export class UpdateTradePlanDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  plannedAmount?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  stopLossCondition?: string;

  @IsOptional()
  @IsString()
  takeProfitCondition?: string;

  @IsOptional()
  @IsBoolean()
  allowAddPosition?: boolean;

  @IsOptional()
  @IsString()
  status?: string;
}
