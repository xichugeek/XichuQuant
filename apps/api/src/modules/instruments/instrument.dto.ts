import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateInstrumentDto {
  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  market?: string;

  @IsString()
  assetType!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  underlyingSymbol?: string;

  @IsOptional()
  @IsString()
  riskTheme?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  leverageRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  leverageMultiplier?: number;

  @IsOptional()
  @IsIn(["LONG", "SHORT", "INVERSE"])
  direction?: "LONG" | "SHORT" | "INVERSE";

  @IsOptional()
  @IsBoolean()
  leveragedETF?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateInstrumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  market?: string;

  @IsOptional()
  @IsString()
  assetType?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  underlyingSymbol?: string;

  @IsOptional()
  @IsString()
  riskTheme?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  leverageRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  leverageMultiplier?: number;

  @IsOptional()
  @IsIn(["LONG", "SHORT", "INVERSE"])
  direction?: "LONG" | "SHORT" | "INVERSE";

  @IsOptional()
  @IsBoolean()
  leveragedETF?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
