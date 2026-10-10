import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class RunBrokerSyncDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  idempotencyKey?: string;
}

export class RunReconciliationDto {
  @IsString()
  brokerAccountId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  amountAbsolute?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  percentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceAbsolute?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityAbsolute?: number;
}

export class ReconciliationDecisionDto {
  @IsIn(["CONFIRMED_BROKER", "CONFIRMED_LOCAL", "IGNORED", "MANUALLY_ADJUSTED", "RESOLVED"])
  decision!: string;

  @IsString()
  @MinLength(2)
  operatorId!: string;

  @IsString()
  @MinLength(4)
  reason!: string;

  @IsOptional()
  @IsNumber()
  acceptedNumericValue?: number;
}

export class CreateShadowIntentDto {
  @IsString()
  brokerAccountId!: string;

  @IsOptional()
  @IsString()
  strategyId?: string;

  @IsOptional()
  @IsString()
  portfolioId?: string;

  @IsString()
  symbol!: string;

  @IsIn(["BUY", "SELL"])
  side!: "BUY" | "SELL";

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsNumber()
  @Min(0.000001)
  theoreticalPrice!: number;

  @IsDateString()
  signalDate!: string;
}

export class UpdateBrokerSettingsDto {
  @IsOptional()
  @IsIn(["OFFLINE", "MOCK", "PAPER", "SHADOW", "READ_ONLY_LIVE"])
  runMode?: string;

  @IsOptional()
  @IsIn(["LOCKDOWN", "NORMAL", "READ_ONLY", "SHADOW_ONLY"])
  safetyState?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoReconciliation?: boolean;

  @IsOptional()
  @IsBoolean()
  shadowTradingEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(86_400)
  staleAfterSeconds?: number;

  @IsBoolean()
  acknowledgeNoBrokerWrites!: boolean;

  @IsString()
  @MinLength(4)
  operatorId!: string;

  @IsString()
  @MinLength(4)
  reason!: string;
}
