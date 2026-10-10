import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateRiskRuleDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  ruleType!: string;

  @IsNumber()
  limitValue!: number;

  @IsString()
  level!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRiskRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  ruleType?: string;

  @IsOptional()
  @IsNumber()
  limitValue?: number;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
