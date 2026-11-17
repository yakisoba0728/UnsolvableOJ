function whitespace(byte: number) {
  return byte === 32 || (byte >= 9 && byte <= 13);
}

function trimmedEnd(buffer: Buffer, start: number, end: number) {
  while (end > start && whitespace(buffer[end - 1])) end--;
  return end;
}

/** Compare bytes, ignoring trailing ASCII whitespace per line and trailing blank lines.
 * Numeric offsets keep auxiliary memory constant even for an output full of newlines.
 */
export function sameOutput(actual: Buffer, expected: Buffer): boolean {
  const actualEnd = trimmedEnd(actual, 0, actual.length);
  const expectedEnd = trimmedEnd(expected, 0, expected.length);
  let actualStart = 0;
  let expectedStart = 0;
  while (actualStart < actualEnd && expectedStart < expectedEnd) {
    let actualNext = actual.indexOf(10, actualStart);
    let expectedNext = expected.indexOf(10, expectedStart);
    if (actualNext === -1 || actualNext > actualEnd) actualNext = actualEnd;
    if (expectedNext === -1 || expectedNext > expectedEnd) expectedNext = expectedEnd;
    const actualLineEnd = trimmedEnd(actual, actualStart, actualNext);
    const expectedLineEnd = trimmedEnd(expected, expectedStart, expectedNext);
    if (actualLineEnd - actualStart !== expectedLineEnd - expectedStart ||
        actual.compare(expected, expectedStart, expectedLineEnd, actualStart, actualLineEnd) !== 0) return false;
    actualStart = actualNext + 1;
    expectedStart = expectedNext + 1;
  }
  return actualStart >= actualEnd && expectedStart >= expectedEnd;
}
