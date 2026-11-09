import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';
import { SubmissionStatus } from '../submission.enums.js';

export class ListSubmissionsQuery extends ListQuery {
  @IsOptional()
  @IsUUID()
  problemId?: string;
}

export class ListProblemSubmissionsQuery extends ListQuery {
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;
}

export class RejudgeProblemDto {
  @IsOptional()
  @IsUUID()
  after?: string;
}
