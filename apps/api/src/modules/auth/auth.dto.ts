import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(120) username!: string;
  @IsString() @MinLength(12) @MaxLength(256) password!: string;
}
