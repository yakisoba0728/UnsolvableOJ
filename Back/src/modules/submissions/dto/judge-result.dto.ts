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
import { TestResultDto } from './test-result.dto.js';
import { SubmissionStatus } from '../submission.enums.js';

export class JudgeResultDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DebugOutputDto)
  debugOutputs?: DebugOutputDto[];

  // 구버전 워커는 보내지 않는다. API로 만든 문제는 테스트가 최대 100개지만, 가져오기 스크립트로
  // 넣은 문제는 더 많을 수 있어 넉넉히 받는다(넘치면 판정 전체가 거절돼 SYSTEM_ERROR가 된다).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => TestResultDto)
  testResults?: TestResultDto[];

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
