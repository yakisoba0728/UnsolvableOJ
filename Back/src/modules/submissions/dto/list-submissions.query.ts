import { IsOptional, IsUUID } from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';

export class ListSubmissionsQuery extends ListQuery {
  @IsOptional()
  @IsUUID()
  problemId?: string;
}
