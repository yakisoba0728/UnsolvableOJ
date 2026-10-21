import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { ProblemDifficulty, ProblemStatus } from '../problem.enums.js';
import { ExpectedOutputValidator } from './expected-output.validator.js';

export class CreateTestCaseDto {
  @IsString()
  @MaxLength(1_000_000)
  input: string;

  @IsString()
  @MaxLength(1_000_000)
  @Validate(ExpectedOutputValidator)
  expectedOutput: string;

  @IsBoolean()
  isSample: boolean;

  @IsInt()
  @Min(1)
  @Max(10_000)
  score = 1;
}

// Shared validation has no creation defaults: PATCH must preserve omitted fields.
export class ProblemContentDto {
  @IsString()
  @Length(1, 150)
  title: string;

  @IsString()
  @MaxLength(200_000)
  statementMarkdown: string;

  @IsString()
  @MaxLength(100_000)
  inputDescriptionMarkdown: string;

  @IsString()
  @MaxLength(100_000)
  outputDescriptionMarkdown: string;

  @IsEnum(ProblemDifficulty)
  difficulty: ProblemDifficulty;

  @IsInt()
  @Min(100)
  @Max(60_000)
  timeLimitMs: number;

  @IsInt()
  @Min(16)
  @Max(4096)
  memoryLimitMb: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateTestCaseDto)
  testCases: CreateTestCaseDto[];
}

export class CreateProblemDto extends ProblemContentDto {
  @ApiProperty({ example: 'a-plus-b' })
  @IsString()
  @Length(3, 80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @IsOptional()
  @IsEnum(ProblemStatus)
  status: ProblemStatus = ProblemStatus.DRAFT;

  override timeLimitMs = 1000;
  override memoryLimitMb = 256;
}
