import {
  ArrayMaxSize,
  IsArray,
  ValidateNested,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DebugOutputDto } from './debug-output.dto.js';
import { SubmissionStatus } from '../submission.enums.js';

export class JudgeResultDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DebugOutputDto)
  debugOutputs?: DebugOutputDto[];

  @IsEnum(SubmissionStatus)
  status: SubmissionStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  runtimeMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  memoryKb?: number;

  @IsInt()
  @Min(0)
  passedTestCases: number;

  @IsInt()
  @Min(0)
  totalTestCases: number;

  @IsOptional()
  @IsString()
  @MaxLength(65_536)
  compileOutput?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  judgeMessage?: string;
}
