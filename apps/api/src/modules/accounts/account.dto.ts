import { IsISO8601, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateAccountDto {
  @IsString()
  userId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  broker?: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsNumber()
  @Min(0)
  initialCapital!: number;

  @IsNumber()
  @Min(0)
  totalEquity!: number;

  @IsNumber()
  @Min(0)
  cashBalance!: number;

  @IsOptional()
  @IsNumber()
  realizedPnlYtd?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  broker?: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialCapital?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalEquity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashBalance?: number;

  @IsOptional()
  @IsNumber()
  realizedPnlYtd?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateEquitySnapshotDto {
  @IsISO8601()
  snapshotDate!: string;

  @IsNumber()
  @Min(0)
  totalEquity!: number;

  @IsNumber()
  @Min(0)
  cashBalance!: number;

  @IsNumber()
  realizedPnlYtd!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
