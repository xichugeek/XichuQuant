import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class PreviewMarketDataDto {
  @IsString()
  @MinLength(1)
  @MaxLength(260)
  fileName!: string;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  providerCode?: string;
}
