import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { IMPORT_RECORD_TYPES, type ImportRecordType } from "./import.types";

export class PreviewImportDto {
  @IsString()
  accountId!: string;

  @IsString()
  @MaxLength(260)
  fileName!: string;

  @IsString()
  @MaxLength(20_000_000)
  content!: string;
}

export class ResolveImportRecordDto {
  @IsOptional()
  @IsIn(IMPORT_RECORD_TYPES)
  recordType?: ImportRecordType;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsISO8601()
  transactionDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentPrice?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commission?: number;

  @IsOptional()
  @IsNumber()
  realizedPnl?: number;

  @IsOptional()
  @IsNumber()
  costBasis?: number;

  @IsOptional()
  @IsNumber()
  marketValue?: number;

  @IsOptional()
  @IsString()
  corporateActionType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  splitRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  fxRateToBase?: number;

  @IsString()
  @MaxLength(1000)
  resolutionNote!: string;
}
