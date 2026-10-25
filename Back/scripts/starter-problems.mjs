// Original starter problems. Oracles below generate private cases independently
// from the efficient reference solutions used by starter-problems.test.mjs.
const sample = (input, expectedOutput) => ({ input, expectedOutput: `${expectedOutput}\n`, isSample: true, score: 1 });
const hidden = (input, expectedOutput) => ({ ...sample(input, expectedOutput), isSample: false });
const records = [];
function add(slug, title, difficulty, statement, input, output, cases, solve) {
  records.push({
    dto: { slug: `starter-${slug}`, title, difficulty, status: 'PUBLISHED',
      statementMarkdown: statement, inputDescriptionMarkdown: input,
      outputDescriptionMarkdown: output, timeLimitMs: 2000, memoryLimitMb: 256,
      testCases: cases },
    solve,
  });
}
let state = 20261026;
const random = (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };

add('sum', '두 수의 합', 'BEGINNER',
  '두 정수 A와 B의 합을 구하세요.',
  '첫 줄에 A와 B가 공백으로 구분되어 주어집니다. −1,000,000,000 ≤ A, B ≤ 1,000,000,000.',
  'A + B를 출력하세요.',
  [sample('3 8\n', 11), sample('-5 2\n', -3),
    ...[[0, 0], [1000000000, 1000000000], [-1000000000, -1000000000], [5, -5], [0, -1], [999999999, -1000000000], [7, 0], [-13, -29]]
      .map(([a, b]) => hidden(`${a} ${b}\n`, BigInt(a) + BigInt(b)))],
  (input) => input.trim().split(/\s+/).map(BigInt).reduce((a, b) => a + b).toString());

add('leap-year', '달력의 하루', 'BEGINNER',
  '주어진 연도가 윤년인지 판단하세요. 4의 배수인 해는 윤년입니다. 단, 100의 배수인 해는 평년이고, 그중 400의 배수인 해는 다시 윤년입니다.',
  '첫 줄에 연도 Y가 주어집니다. 1 ≤ Y ≤ 10,000.',
  '윤년이면 YES, 평년이면 NO를 출력하세요.',
  [sample('2024\n', 'YES'), sample('1900\n', 'NO'),
    ...[[1, 'NO'], [4, 'YES'], [100, 'NO'], [400, 'YES'], [2000, 'YES'], [2100, 'NO'], [9999, 'NO'], [10000, 'YES']]
      .map(([y, answer]) => hidden(`${y}\n`, answer))],
  (input) => { const y = Number(input); return y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0) ? 'YES' : 'NO'; });

const arrays = [[8, -3, 6, 6, 0], [42], [0, 0, 0], [-9, -1, -5], [-1000000000, 1000000000],
  ...Array.from({ length: 8 }, () => Array.from({ length: random(80) + 1 }, () => random(2001) - 1000)),
  Array.from({ length: 10000 }, (_, i) => i - 5000)];
add('min-max', '기온 기록', 'BEGINNER',
  'N일 동안 기록한 기온에서 가장 낮은 기온과 가장 높은 기온을 구하세요.',
  '첫 줄에 N(1 ≤ N ≤ 100,000)이 주어집니다. 둘째 줄에 N개의 정수 기온이 주어집니다. 각 기온은 −1,000,000,000 이상 1,000,000,000 이하입니다.',
  '최저 기온과 최고 기온을 공백으로 구분하여 출력하세요.',
  arrays.map((a, i) => { const sorted = [...a].sort((x, y) => x - y); return (i < 2 ? sample : hidden)(`${a.length}\n${a.join(' ')}\n`, `${sorted[0]} ${sorted.at(-1)}`); }),
  (input) => { const a = input.trim().split(/\s+/).map(Number).slice(1); let lo = Infinity, hi = -Infinity; for (const x of a) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return `${lo} ${hi}`; });

const brackets = ['(())()', '(()', ')(', '()', '((()))', '())(', '(', ')', '(()())()', '()()(()())'];
const bracketOracle = (s) => { while (s.includes('()')) s = s.replaceAll('()', ''); return s === '' ? 'YES' : 'NO'; };
add('brackets', '괄호 검사기', 'EASY',
  '여는 괄호와 닫는 괄호로만 이루어진 문자열이 올바른 괄호 문자열인지 판단하세요. 모든 여는 괄호가 뒤의 닫는 괄호와 짝을 이루고, 문자열을 앞에서 읽는 도중 닫는 괄호가 더 많아지는 순간이 없어야 합니다.',
  '첫 줄에 괄호 문자열 하나가 주어집니다. 길이는 1 이상 100,000 이하이며 문자 (와 )만 포함합니다.',
  '올바르면 YES, 아니면 NO를 출력하세요.',
  [...brackets.map((s, i) => (i < 2 ? sample : hidden)(`${s}\n`, bracketOracle(s))),
    hidden(`${'('.repeat(50000)}${')'.repeat(50000)}\n`, 'YES'), hidden(`${'()'.repeat(49999)})(\n`, 'NO')],
  (input) => { let level = 0; for (const c of input.trim()) { level += c === '(' ? 1 : -1; if (level < 0) return 'NO'; } return level === 0 ? 'YES' : 'NO'; });

const ranges = [
  { a: [3, -2, 7, 1, 4], q: [[1, 3], [2, 5], [4, 4]] },
  { a: [-9], q: [[1, 1]] },
  ...Array.from({ length: 9 }, () => { const a = Array.from({ length: random(80) + 1 }, () => random(2000000001) - 1000000000); return { a, q: Array.from({ length: 30 }, () => { const x = random(a.length) + 1, y = random(a.length) + 1; return [Math.min(x, y), Math.max(x, y)]; }) }; }),
  { a: Array(10000).fill(1000000000), q: [[1, 10000], [5000, 5000], [100, 9900]] },
];
add('range-sum', '구간 점수 합계', 'EASY',
  'N개의 점수가 주어집니다. L번째 점수부터 R번째 점수까지의 합을 묻는 Q개의 질문에 답하세요. 위치는 1부터 시작합니다.',
  '첫 줄에 N과 Q(각각 1 이상 100,000 이하)가 주어집니다. 둘째 줄에 N개의 정수 점수가 주어집니다. 각 점수의 절댓값은 1,000,000,000 이하입니다. 이후 Q개 줄에 L과 R(1 ≤ L ≤ R ≤ N)이 주어집니다.',
  '각 질문의 답을 한 줄에 하나씩 출력하세요. 합은 32비트 정수 범위를 넘을 수 있습니다.',
  ranges.map(({ a, q }, i) => (i < 2 ? sample : hidden)(`${a.length} ${q.length}\n${a.join(' ')}\n${q.map((p) => p.join(' ')).join('\n')}\n`, q.map(([l, r]) => a.slice(l - 1, r).reduce((s, x) => s + BigInt(x), 0n).toString()).join('\n'))),
  (input) => { const t = input.trim().split(/\s+/).map(Number); let k = 0; const n = t[k++], q = t[k++], p = [0], out = []; for (let i = 0; i < n; i++) p.push(p.at(-1) + t[k++]); for (let i = 0; i < q; i++) { const l = t[k++], r = t[k++]; out.push(p[r] - p[l - 1]); } return out.join('\n'); });

const counts = [
  { a: [4, 2, 4, -1, 4], q: [4, 3, -1] }, { a: [7], q: [7, 0] },
  ...Array.from({ length: 9 }, () => ({ a: Array.from({ length: random(100) + 1 }, () => random(15) - 7), q: Array.from({ length: 25 }, () => random(25) - 12) })),
  { a: Array(10000).fill(-1000000000), q: [-1000000000, 1000000000, 0] },
];
add('frequency', '창고의 부품 번호', 'EASY',
  '창고에 있는 부품 N개의 번호가 주어집니다. 질문으로 주어진 번호의 부품이 각각 몇 개 있는지 구하세요. 같은 번호가 여러 번 나타날 수 있습니다.',
  '첫 줄에 N(1 ≤ N ≤ 100,000), 둘째 줄에 N개의 부품 번호가 주어집니다. 셋째 줄에 Q(1 ≤ Q ≤ 100,000), 넷째 줄에 Q개의 질문 번호가 주어집니다. 모든 번호는 절댓값이 1,000,000,000 이하인 정수입니다.',
  '질문 순서대로 해당 번호의 부품 수를 한 줄에 하나씩 출력하세요.',
  counts.map(({ a, q }, i) => (i < 2 ? sample : hidden)(`${a.length}\n${a.join(' ')}\n${q.length}\n${q.join(' ')}\n`, q.map((x) => a.filter((y) => x === y).length).join('\n'))),
  (input) => { const t = input.trim().split(/\s+/).map(Number); let k = 0; const n = t[k++], a = t.slice(k, k + n).sort((x, y) => x - y); k += n; const q = t[k++], out = []; const bound = (x, upper) => { let l = 0, r = n; while (l < r) { const m = (l + r) >> 1; if (a[m] < x || (upper && a[m] === x)) l = m + 1; else r = m; } return l; }; for (let i = 0; i < q; i++) { const x = t[k++]; out.push(bound(x, true) - bound(x, false)); } return out.join('\n'); });

function gridOracle(rows) {
  const h = rows.length, w = rows[0].length;
  if (rows[0][0] === '1' || rows[h - 1][w - 1] === '1') return -1;
  const d = Array(h * w).fill(Infinity); d[0] = 0;
  // Repeated relaxation, independent from the queue-based reference.
  for (let pass = 0; pass < h * w; pass++) {
    let changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '0') {
      for (const [dy, dx] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < h && nx >= 0 && nx < w && rows[ny][nx] === '0' && d[ny * w + nx] > d[y * w + x] + 1) { d[ny * w + nx] = d[y * w + x] + 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  return Number.isFinite(d.at(-1)) ? d.at(-1) : -1;
}
const grids = [['000', '110', '000'], ['01', '10'], ['0'], ['1'], ['00000'], ['0', '1', '0'],
  ...Array.from({ length: 10 }, () => Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => random(4) === 0 ? '1' : '0').join('')))];
add('grid-distance', '격자 배송 경로', 'MEDIUM',
  '0은 지나갈 수 있는 칸, 1은 벽입니다. 왼쪽 위 칸에서 오른쪽 아래 칸까지 상하좌우로 이동할 때 필요한 최소 이동 횟수를 구하세요. 시작 칸과 도착 칸도 지나갈 수 있어야 합니다. 시작과 도착이 같고 지나갈 수 있으면 답은 0입니다.',
  '첫 줄에 높이 H와 너비 W(1 ≤ H, W ≤ 300)가 주어집니다. 이후 H개 줄에 0과 1로만 이루어진 길이 W의 문자열이 주어집니다.',
  '최소 이동 횟수를 출력하세요. 도착할 수 없으면 -1을 출력하세요.',
  [...grids.map((rows, i) => (i < 2 ? sample : hidden)(`${rows.length} ${rows[0].length}\n${rows.join('\n')}\n`, gridOracle(rows))), hidden(`60 60\n${Array(60).fill('0'.repeat(60)).join('\n')}\n`, 118)],
  (input) => { const lines = input.trim().split(/\s+/), h = Number(lines[0]), w = Number(lines[1]), rows = lines.slice(2); if (rows[0][0] !== '0' || rows[h - 1][w - 1] !== '0') return '-1'; const d = Array(h * w).fill(-1), queue = [0]; d[0] = 0; for (let head = 0; head < queue.length; head++) { const p = queue[head], y = Math.floor(p / w), x = p % w; for (const [dy, dx] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const ny = y + dy, nx = x + dx, np = ny * w + nx; if (ny >= 0 && ny < h && nx >= 0 && nx < w && rows[ny][nx] === '0' && d[np] === -1) { d[np] = d[p] + 1; queue.push(np); } } } return String(d.at(-1)); });

function coinOracle(coins, target) {
  const d = Array(target + 1).fill(-1), queue = [0]; d[0] = 0;
  for (let h = 0; h < queue.length; h++) for (const c of coins) { const next = queue[h] + c; if (next <= target && d[next] === -1) { d[next] = d[queue[h]] + 1; queue.push(next); } }
  return d[target];
}
const coinCases = [{ c: [1, 3, 4], t: 6 }, { c: [4, 6], t: 7 }, { c: [5], t: 0 }, { c: [7], t: 7 }, { c: [7], t: 6 }, { c: [1], t: 10000 },
  ...Array.from({ length: 10 }, () => ({ c: [...new Set(Array.from({ length: 6 }, () => random(25) + 1))], t: random(150) }))];
add('coin-change', '가장 적은 교환권', 'MEDIUM',
  '서로 다른 N종류의 교환권으로 정확히 K의 금액을 만드세요. 각 종류는 원하는 만큼 사용할 수 있습니다. 사용하는 교환권 수를 최소화해야 합니다.',
  '첫 줄에 N과 K(1 ≤ N ≤ 100, 0 ≤ K ≤ 10,000)가 주어집니다. 둘째 줄에 서로 다른 N개의 교환권 금액(각각 1 이상 10,000 이하)이 주어집니다.',
  '필요한 최소 교환권 수를 출력하세요. 만들 수 없으면 -1을 출력하세요. K가 0이면 답은 0입니다.',
  coinCases.map(({ c, t }, i) => (i < 2 ? sample : hidden)(`${c.length} ${t}\n${c.join(' ')}\n`, coinOracle(c, t))),
  (input) => { const a = input.trim().split(/\s+/).map(Number), n = a[0], k = a[1], c = a.slice(2, 2 + n), d = Array(k + 1).fill(Infinity); d[0] = 0; for (let t = 1; t <= k; t++) for (const x of c) if (x <= t) d[t] = Math.min(d[t], d[t - x] + 1); return String(Number.isFinite(d[k]) ? d[k] : -1); });

const lisOracle = (a) => { const d = a.map(() => 1); for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) if (a[j] < a[i]) d[i] = Math.max(d[i], d[j] + 1); return Math.max(...d); };
const sequences = [[4, 1, 3, 2, 5], [2, 2, 2], [9], [5, 4, 3, 2, 1], [-10, -5, 0, 5], [1, 3, 2, 4, 3, 5],
  ...Array.from({ length: 10 }, () => Array.from({ length: random(60) + 1 }, () => random(101) - 50))];
add('lis', '오름차순 기록', 'MEDIUM',
  '수열에서 일부 원소를 골라 순서를 유지하면서 엄격하게 증가하는 부분 수열을 만드세요. 고른 원소가 원래 수열에서 연속할 필요는 없습니다. 만들 수 있는 가장 긴 길이를 구하세요. 같은 값은 증가로 보지 않습니다.',
  '첫 줄에 N(1 ≤ N ≤ 100,000)이 주어집니다. 둘째 줄에 N개의 정수가 주어집니다. 각 정수의 절댓값은 1,000,000,000 이하입니다.',
  '가장 긴 엄격한 증가 부분 수열의 길이를 출력하세요.',
  [...sequences.map((a, i) => (i < 2 ? sample : hidden)(`${a.length}\n${a.join(' ')}\n`, lisOracle(a))), hidden(`10000\n${Array.from({ length: 10000 }, (_, i) => i).join(' ')}\n`, 10000)],
  (input) => { const a = input.trim().split(/\s+/).map(Number).slice(1), tails = []; for (const x of a) { let l = 0, r = tails.length; while (l < r) { const m = (l + r) >> 1; if (tails[m] < x) l = m + 1; else r = m; } tails[l] = x; } return String(tails.length); });

const graphs = [{ n: 5, e: [[1, 2], [2, 3], [4, 5]] }, { n: 3, e: [] }, { n: 1, e: [] }, { n: 2, e: [[1, 1], [1, 1]] },
  ...Array.from({ length: 10 }, () => { const n = random(25) + 1; return { n, e: Array.from({ length: random(80) }, () => [random(n) + 1, random(n) + 1]) }; }),
  { n: 5000, e: Array.from({ length: 4999 }, (_, i) => [i + 1, i + 2]) }];
function graphOracle(n, edges) { const p = Array.from({ length: n + 1 }, (_, i) => i); const find = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }; for (const [u, v] of edges) p[find(u)] = find(v); return new Set(Array.from({ length: n }, (_, i) => find(i + 1))).size; }
add('components', '통신망 묶음', 'EASY',
  '1번부터 N번까지의 장치가 양방향 통신선으로 연결되어 있습니다. 여러 통신선을 따라 서로 도달할 수 있는 장치들을 하나의 묶음으로 볼 때, 묶음 수를 구하세요. 연결되지 않은 장치 하나도 하나의 묶음입니다.',
  '첫 줄에 N과 M(1 ≤ N ≤ 100,000, 0 ≤ M ≤ 200,000)이 주어집니다. 이후 M개 줄에 통신선의 양 끝 번호 U와 V(1 ≤ U, V ≤ N)가 주어집니다. 같은 통신선이 여러 번 주어지거나 U와 V가 같을 수 있습니다.',
  '서로 분리된 묶음의 수를 출력하세요.',
  graphs.map(({ n, e }, i) => (i < 2 ? sample : hidden)(`${n} ${e.length}\n${e.map((x) => x.join(' ')).join('\n')}${e.length ? '\n' : ''}`, graphOracle(n, e))),
  (input) => { const t = input.trim().split(/\s+/).map(Number), n = t[0], m = t[1], g = Array.from({ length: n }, () => []), seen = Array(n).fill(false); for (let i = 0; i < m; i++) { const u = t[2 + i * 2] - 1, v = t[3 + i * 2] - 1; g[u].push(v); g[v].push(u); } let total = 0; for (let i = 0; i < n; i++) if (!seen[i]) { total++; const stack = [i]; seen[i] = true; while (stack.length) for (const j of g[stack.pop()]) if (!seen[j]) { seen[j] = true; stack.push(j); } } return String(total); });

export const starterProblems = records;
