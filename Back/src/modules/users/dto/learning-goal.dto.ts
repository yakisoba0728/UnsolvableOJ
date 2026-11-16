import { IsIn, IsInt, Max, Min } from 'class-validator';

/** JSON numbers only. Dates, ownership and progress are always server-owned. */
export class SetLearningGoalDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  targetProblems: number;

  @IsInt()
  @IsIn([7, 30, 90])
  days: number;
}
