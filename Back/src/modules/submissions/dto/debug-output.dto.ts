import { IsBoolean, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class DebugOutputDto {
  @IsInt()
  @Min(1)
  testCase: number;

  @IsString()
  @MaxLength(1000)
  stdout: string;

  @IsString()
  @MaxLength(1000)
  stderr: string;

  @IsBoolean()
  stdoutTruncated: boolean;

  @IsBoolean()
  stderrTruncated: boolean;
}
