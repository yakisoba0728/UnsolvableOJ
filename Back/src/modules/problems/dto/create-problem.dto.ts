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
  ValidateNested,
} from 'class-validator';
import { ProblemDifficulty, ProblemStatus } from '../problem.enums.js';

export class CreateTestCaseDto {
  @IsString()
  @MaxLength(1_000_000)
  input: string;

  @IsString()
  @MaxLength(1_000_000)
  expectedOutput: string;

  @IsBoolean()
  isSample: boolean;

  @IsInt()
  @Min(1)
  @Max(10_000)
  score = 1;
}

export class CreateProblemDto {
  @ApiProperty({ example: 'a-plus-b' })
  @IsString()
  @Length(3, 80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

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

  @IsOptional()
  @IsEnum(ProblemStatus)
  status: ProblemStatus = ProblemStatus.DRAFT;

  @IsInt()
  @Min(100)
  @Max(60_000)
  timeLimitMs = 1000;

  @IsInt()
  @Min(16)
  @Max(4096)
  memoryLimitMb = 256;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateTestCaseDto)
  testCases: CreateTestCaseDto[];
}
