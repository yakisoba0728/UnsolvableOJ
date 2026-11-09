import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';
import { IsPostgresText } from '../../../common/postgres-text.js';
import { ProblemDifficulty } from '../problem.enums.js';

const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',') : value;

export const PROBLEM_SORTS = [
  'latest',
  'difficulty',
  'title',
  'solvers',
  'rate',
  'random',
] as const;
export const SOLVE_STATES = ['solved', 'attempted', 'none'] as const;

export class ListProblemsQuery extends ListQuery {
  /** 제목·slug 부분 일치(대소문자 무시) */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @IsPostgresText()
  q?: string;

  /** 쉼표로 여러 개. 하나만 보내던 옛 호출(difficulty=HARD)도 그대로 된다. */
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(ProblemDifficulty, { each: true })
  @ArrayUnique()
  difficulty?: ProblemDifficulty[];

  @IsOptional()
  @IsString()
  @Length(1, 30)
  @IsPostgresText()
  tag?: string;

  /** 내 풀이 상태(로그인 필요). 문제의 공개 상태(status)와 헷갈리지 않게 이름을 나눈다. */
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(SOLVE_STATES, { each: true })
  @ArrayUnique()
  solve?: (typeof SOLVE_STATES)[number][];

  @IsOptional()
  @IsIn(PROBLEM_SORTS)
  sort?: (typeof PROBLEM_SORTS)[number];

  /** true면 정렬의 기본 방향을 뒤집는다. 정답률이 없는 문제는 어느 쪽이든 맨 뒤다. */
  @IsOptional()
  @IsIn(['true', 'false'])
  reverse?: string;

  /** 무작위 정렬의 순서. 같은 값이면 쪽을 넘겨도 같은 순서다. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  seed?: number;
}
