import { Buffer } from 'node:buffer';
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isJudgeableExpectedOutput', async: false })
export class ExpectedOutputValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let end = value.length;
    // Match the judge's byte-wise rstrip, not JavaScript's Unicode trimEnd.
    while (end > 0 && /[\t\n\v\f\r ]/.test(value[end - 1])) end--;
    return Buffer.byteLength(value.slice(0, end), 'utf8') <= 999_999;
  }

  defaultMessage(): string {
    return 'expectedOutput의 끝 ASCII 공백을 제외한 UTF-8 크기는 999999바이트 이하여야 합니다.';
  }
}
