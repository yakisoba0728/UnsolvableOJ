import { IsEnum } from 'class-validator';
import { ProblemStatus } from '../problem.enums.js';

export class ChangeProblemStatusDto {
  @IsEnum(ProblemStatus)
  status: ProblemStatus;
}
