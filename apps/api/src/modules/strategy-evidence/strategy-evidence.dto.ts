import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";

export const evidenceMetricCodes = [
  "FUNDAMENTAL_GROWTH_SCORE",
  "ORDER_BOOK_IMBALANCE",
  "FINANCIAL_CONDITIONS_Z",
  "SHORT_INTEREST_PERCENT",
  "DAYS_TO_COVER",
  "EFFECTIVE_FED_FUNDS_RATE",
  "FED_BROAD_DOLLAR_INDEX",
  "CBOE_VIX_CLOSE",
] as const;

export class ImportStrategyEvidenceDto {
  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  providerCode!: string;

  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9._-]{1,32}$/)
  symbol!: string;

  @IsIn(evidenceMetricCodes)
  metricCode!: (typeof evidenceMetricCodes)[number];

  @IsISO8601({ strict: true })
  observedAt!: string;

  @IsISO8601({ strict: true })
  availableAt!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;

  @Type(() => Number)
  @IsNumber()
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  derivation?: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(1000)
  sourceUrl!: string;

  @IsOptional()
  @IsObject()
  rawData?: Record<string, unknown>;
}

export class SyncSecFundamentalsDto {
  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9._-]{1,32}$/)
  symbol!: string;

  @Transform(({ value }: { value: unknown }) => String(value).replace(/\D/g, "").padStart(10, "0"))
  @Matches(/^\d{10}$/)
  cik!: string;
}

export class SyncFredFinancingDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9._-]{1,32}$/)
  seriesId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  observationStart?: string;
}

export class SyncFredMarketFactorsDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  observationStart?: string;
}

export class CaptureIbkrTopOfBookDto {
  @Transform(({ value }: { value: unknown }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9._-]{1,32}$/)
  symbol!: string;

  @IsString()
  @Matches(/^\d{1,20}$/)
  contractId!: string;
}
