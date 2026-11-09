import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import { SubmissionStatus } from '../submission.enums.js';

/** 테스트 하나의 판정. 비공개 테스트도 번호·판정·시간·메모리만 담고 입력·출력은 받지 않는다. */
export class TestResultDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  testCase: number;

  @IsBoolean()
  isSample: boolean;

  @IsIn([
    SubmissionStatus.ACCEPTED,
    SubmissionStatus.WRONG_ANSWER,
    SubmissionStatus.TIME_LIMIT_EXCEEDED,
    SubmissionStatus.MEMORY_LIMIT_EXCEEDED,
    SubmissionStatus.RUNTIME_ERROR,
    SubmissionStatus.OUTPUT_LIMIT_EXCEEDED,
  ])
  status: SubmissionStatus;

  @IsInt()
  @Min(0)
  @Max(86_400_000)
  runtimeMs: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  memoryKb: number;
}
