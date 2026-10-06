import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum CommunityCategory {
  QUESTION = 'QUESTION',
  SOLUTION = 'SOLUTION',
  REVIEW = 'REVIEW',
  FREE = 'FREE',
  NOTICE = 'NOTICE',
}
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CommunityPostDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
  @IsEnum(CommunityCategory)
  category: CommunityCategory;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(30_000)
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  language?: string;

  @IsOptional()
  @IsUUID()
  problemId?: string | null;
}

export class CommunityCommentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body: string;
}

export class CommunityQuery {
  @IsOptional()
  @IsIn(['latest', 'votes', 'answers'])
  sort?: 'latest' | 'votes' | 'answers';
  @IsOptional()
  @IsEnum(CommunityCategory)
  category?: CommunityCategory;

  @IsOptional()
  @IsUUID()
  problemId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
