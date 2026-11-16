import assert from "node:assert/strict";
import { test } from "node:test";
import { sameOutput } from "./output.js";

// Latin-1 preserves each byte independently, including invalid UTF-8 and NUL.
// This intentionally simple reference is only used with bounded test fixtures.
function normalized(buffer: Buffer) {
  const lines = buffer.toString("latin1").split("\n").map((line) => line.replace(/[\t\v\f\r ]+$/g, ""));
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

test("comparison matches the byte-preserving reference for all 160,000 short pairs", () => {
  const buffers: Buffer[] = [Buffer.alloc(0)];
  let previous = buffers;
  for (let length = 1; length <= 3; length++) {
    const next: Buffer[] = [];
    for (const prefix of previous) for (const byte of [0, 9, 10, 13, 32, 65, 255]) {
      next.push(Buffer.concat([prefix, Buffer.from([byte])]));
    }
    buffers.push(...next);
    previous = next;
  }
  assert.equal(buffers.length, 400);
  const references = buffers.map(normalized);
  for (let a = 0; a < buffers.length; a++) for (let b = 0; b < buffers.length; b++) {
    assert.equal(sameOutput(buffers[a], buffers[b]), references[a] === references[b],
      `actual=${buffers[a].toString("hex")} expected=${buffers[b].toString("hex")}`);
  }
});

test("comparison preserves every possible byte and distinguishes internal blank lines", () => {
  const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  assert.equal(sameOutput(allBytes, Buffer.from(allBytes)), true);
  for (const byte of [9, 10, 11, 12, 13, 32]) {
    assert.equal(sameOutput(Buffer.from([65, byte]), Buffer.from([65])), true);
    assert.equal(sameOutput(Buffer.from([65, byte, 66]), Buffer.from([65, 66])), false);
  }
  assert.equal(sameOutput(Buffer.from("x\n\ny"), Buffer.from("x\ny")), false);
  assert.equal(sameOutput(Buffer.from("\nx"), Buffer.from("x")), false);
  assert.equal(sameOutput(Buffer.from("x\r\n\ty \t\r\n\n"), Buffer.from("x\n\ty")), true);
});

test("legal-sized newline-heavy outputs retain exact comparison semantics", () => {
  assert.equal(sameOutput(Buffer.alloc(999_999, 10), Buffer.alloc(0)), true);
  assert.equal(sameOutput(Buffer.from("x \n".repeat(333_333)), Buffer.from("x\n".repeat(333_333))), true);
  assert.equal(sameOutput(Buffer.from("\n".repeat(999_998) + "x"), Buffer.from("x")), false);
});
