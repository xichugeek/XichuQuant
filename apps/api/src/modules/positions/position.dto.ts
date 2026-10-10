import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreatePositionDto {
  @IsString()
  accountId!: string;

  @IsString()
  symbol!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  avgCost!: number;

  @IsNumber()
  @Min(0)
  currentPrice!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdatePositionDto {
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  avgCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentPrice?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdatePriceDto {
  @IsNumber()
  @Min(0)
  currentPrice!: number;
}
