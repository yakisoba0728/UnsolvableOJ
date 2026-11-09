import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';
import { IsPostgresText } from '../../../common/postgres-text.js';
import { ProblemDifficulty } from '../problem.enums.js';

export class ListProblemsQuery extends ListQuery {
  @IsOptional()
  @IsEnum(ProblemDifficulty)
  difficulty?: ProblemDifficulty;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  @IsPostgresText()
  tag?: string;
}
