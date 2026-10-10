import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateTradeDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsString()
  symbol!: string;

  @IsISO8601()
  tradeDate!: string;

  @IsString()
  side!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commission?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  realizedPnl?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  emotionTag?: string;

  @IsOptional()
  @IsBoolean()
  isRuleFollowed?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateTradeDto {
  @IsOptional()
  @IsString()
  side?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  realizedPnl?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  emotionTag?: string;

  @IsOptional()
  @IsBoolean()
  isRuleFollowed?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
