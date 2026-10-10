import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class RunDailyCycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  providerCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  marketDate?: string;
}

export class MarkNotificationReadDto {
  @IsOptional()
  @IsString()
  id?: string;
}
