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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(CommunityCategory, { each: true })
  @ArrayUnique()
  categories?: CommunityCategory[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['accepted', 'unaccepted'], { each: true })
  @ArrayUnique()
  status?: string[];

  @IsOptional()
  @IsIn(['true', 'false'])
  includePinned?: string;

  @IsOptional()
  @IsIn(['latest', 'votes', 'answers', 'views'])
  sort?: 'latest' | 'votes' | 'answers' | 'views';
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

  // 태그에는 쉼표가 들어갈 수 있어 나누지 않고 tag를 반복해 받는다.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tag?: string[];

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
