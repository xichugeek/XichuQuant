import { IsOptional, IsString } from "class-validator";

export class CreateReviewDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  relatedTradeId?: string;

  @IsOptional()
  @IsString()
  mistakeType?: string;

  @IsString()
  summary!: string;

  @IsString()
  lesson!: string;

  @IsOptional()
  @IsString()
  actionRule?: string;
}

export class UpdateReviewDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  mistakeType?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  lesson?: string;

  @IsOptional()
  @IsString()
  actionRule?: string;
}
