import test from 'node:test';
import assert from 'node:assert/strict';
import domino from '@mixmark-io/domino';
import { assertNoNul, htmlToMarkdown, prepareProblem } from './boj-content.mjs';

test('preserves nested table PRE line breaks, blank lines and indentation in raw HTML', () => {
  const text = '  first\\line\n\n    second < third\n  last\n';
  const result = htmlToMarkdown(
    '<table>\n<tr><td><pre>  first\\line\n\n    second &lt; third\n  last\n</pre></td><td>옆 칸</td></tr>\n</table>',
    'https://www.acmicpc.net/problem/1000',
  );
  assert.equal(
    domino.createDocument(result).querySelector('td pre').textContent,
    text,
  );
  assert.match(result, /&#10;&#10;    second/);
  assert.doesNotMatch(result.match(/<table>[\s\S]*<\/table>/)[0], /\n/);
});

test('retains leading blank lines in nested PRE with or without CODE children', () => {
  for (const html of [
    '<table><tr><td><pre>\n\n  first\n\n    last\n</pre></td></tr></table>',
    '<table><tr><td><pre><code>\n  first\n\n    last\n</code></pre></td></tr></table>',
  ]) {
    const result = htmlToMarkdown(html, 'https://www.acmicpc.net/problem/1000');
    assert.equal(
      domino.createDocument(result).querySelector('td pre').textContent,
      '\n  first\n\n    last\n',
    );
  }
});

test('the import NUL guard accepts printable escapes but rejects actual nested NUL values', () => {
  const item = {
    dto: {
      slug: 'boj-1000',
      testCases: [{ input: String.raw`\u0000`, expectedOutput: 'ok' }],
    },
    provenance: { originalLabels: [String.raw`literal \u0000`] },
  };
  assert.doesNotThrow(() => assertNoNul(item, item.dto.slug));
  item.dto.testCases[0].input = 'actual\u0000NUL';
  assert.throws(() => assertNoNul(item, item.dto.slug), /NUL in boj-1000/);
  item.dto.testCases[0].input = 'ok';
  item.provenance.originalLabels = ['actual\u0000NUL'];
  assert.throws(() => assertNoNul(item, item.dto.slug), /NUL in boj-1000/);
});

test('preserves math, merged table cells, superscripts, code spacing and relative images', () => {
  const result = htmlToMarkdown(
    String.raw`<p>한글 \(a_i &lt; b\)와 $x^2$</p><p>\[\sum_i a_i\]</p><table><tr><td rowspan="2">$n_1$</td><td>A<sup>2</sup></td></tr><tr><td><img src="/upload/a.png"></td></tr></table><pre>  a\b
    c</pre>`,
    'https://www.acmicpc.net/problem/1000',
  );
  assert.match(result, /\$a_i < b\$/);
  assert.match(result, /\$\$\n\\sum_i a_i\n\$\$/);
  assert.match(result, /rowspan="2"/);
  assert.match(result, /class="math-inline">n_1<\/code>/);
  assert.match(result, /A<sup>2<\/sup>/);
  assert.match(result, /src="https:\/\/www.acmicpc.net\/upload\/a.png"/);
  assert.ok(result.includes('```\n  a\\b\n    c\n```'));
  assert.ok(!result.includes('BOJMATH'));
});

test('removes active HTML and links unsupported media without executing it', () => {
  const warnings = [];
  const result = htmlToMarkdown(
    '<script>alert(1)</script><p onclick="x()">설명</p><iframe src="https://example.org/video"></iframe><a href="javascript:alert(1)">링크</a>',
    'https://www.acmicpc.net/problem/1000',
    warnings,
  );
  assert.doesNotMatch(result, /alert|onclick|javascript:/);
  assert.match(result, /https:\/\/example.org\/video/);
  assert.deepEqual(warnings, ['linked_media:iframe']);
});

test('handles malformed source HTML and retains raster data images and diagram colors', () => {
  const result = htmlToMarkdown(
    '<p>한글<utabbehnsa<br></utabbehnsa<br></p><img src="data:image/png;base64,aGVsbG8="><table><tr><td style="background-color: #ff0000; position: fixed">칸</td></tr></table>',
    'https://www.acmicpc.net/problem/17218',
  );
  assert.match(result, /한글/);
  assert.match(result, /data:image\/png;base64,aGVsbG8=/);
  assert.match(result, /background-color: #ff0000/);
  assert.doesNotMatch(result, /position: fixed/);
});

test('normalizes only line endings in samples and includes attribution and extra sections', () => {
  const record = {
    problem_id: 1000,
    url: 'https://www.acmicpc.net/problem/1000',
    title: 'A+B',
    sections: [
      {
        kind: 'description',
        html: '<p>두 정수를 더한다.</p>',
        text: '두 정수를 더한다.',
      },
      { kind: 'limit', heading: '제한', html: '<p>A는 양수</p>' },
    ],
    limits: { time_seconds: 2, memory_mb: 128 },
    samples: [{ input: '  1 2\r\n\r\n', output: '3  \r\n' }],
    labels: [],
    classification: { tags: [] },
    difficulty: { level: 1 },
    source: { sha256: 'test' },
  };
  const { dto, provenance } = prepareProblem(record);
  assert.equal(dto.testCases[0].input, '  1 2\n\n');
  assert.equal(dto.testCases[0].expectedOutput, '3  \n');
  assert.equal(dto.testCases[0].isSample, true);
  assert.equal(dto.difficulty, 'BEGINNER');
  assert.match(dto.statementMarkdown, /## 제한/);
  assert.match(dto.statementMarkdown, /원문: BOJ 1000번/);
  assert.equal(
    provenance.importHash,
    prepareProblem(record).provenance.importHash,
  );
});
