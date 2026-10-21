import { IsEnum, IsOptional } from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';
import { ProblemDifficulty } from '../problem.enums.js';

export class ListProblemsQuery extends ListQuery {
  @IsOptional()
  @IsEnum(ProblemDifficulty)
  difficulty?: ProblemDifficulty;
}
