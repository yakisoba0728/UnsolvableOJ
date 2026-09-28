import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProblemDto } from './create-problem.dto.js';

export class UpdateProblemDto extends PartialType(
  OmitType(CreateProblemDto, ['slug', 'status'] as const),
) {}
