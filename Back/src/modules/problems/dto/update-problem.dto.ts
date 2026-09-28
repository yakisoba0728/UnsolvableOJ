import { PartialType } from '@nestjs/swagger';
import { ProblemContentDto } from './create-problem.dto.js';

export class UpdateProblemDto extends PartialType(ProblemContentDto, {
  skipNullProperties: false,
}) {}
