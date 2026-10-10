import { Type } from "class-transformer";
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateSignalDto {
  @IsString()
  strategyId!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsString()
  @MaxLength(32)
  symbol!: string;

  @IsIn(["BUY", "SELL"])
  signalType!: "BUY" | "SELL";

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  requestedAmount!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  referencePrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  stopLossCondition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exitCondition?: string;

  @IsString()
  @MaxLength(500)
  triggerReason!: string;
}

export class UpdateSignalStatusDto {
  @IsIn(["MANUALLY_DISMISSED", "PAPER_EXECUTED"])
  status!: "MANUALLY_DISMISSED" | "PAPER_EXECUTED";
}
