import { describe, expect, it } from 'vitest';
import { assessmentScore } from './enterprise.service.js';

describe('enterprise task scores', () => {
  it('weights each normal problem and complete vibe task equally', () => {
    expect(assessmentScore(1, 2, [])).toBe(50);
    expect(assessmentScore(0, 0, [89])).toBe(89);
    expect(assessmentScore(1, 1, [89])).toBe(95);
    expect(assessmentScore(0, 1, [89])).toBe(45);
    expect(assessmentScore(0, 0, [0])).toBe(0);
  });
  it('does not turn pending evaluations into zero scores', () => {
    expect(assessmentScore(1, 1, [null])).toBeNull();
  });
});
