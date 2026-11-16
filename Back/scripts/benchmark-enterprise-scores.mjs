import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildEnterpriseVibeScores } from '../dist/modules/enterprise/enterprise-vibe-scores.js';
import { challenge } from '../dist/modules/vibe/vibe.catalog.js';

// Unchanged score assembly from EnterpriseService.vibeScores at baseline 6176015.
function baseline(challengeIds, attemptIds, rows) {
  return new Map(attemptIds.map((id) => [id, challengeIds.map((challengeId) => {
    const row = rows.find((row) => row.enterprise_attempt_id === id && row.challenge_id === challengeId);
    const report = row?.report;
    const score = !row ? 0 : report?.evaluationStatus === 'complete'
      ? report.outcome + report.prompt.score + report.process.score : null;
    return { challengeId, title: challenge.title, id: row?.id ?? null, submittedAt: row?.submitted_at ?? null, score,
      status: !row ? 'not_started' : !row.submitted_at ? 'working' : score === null ? 'pending' : 'complete' };
  })]));
}

function fixture(count) {
  const attemptIds = Array.from({ length: count }, (_, id) => `attempt-${id}`);
  const rows = attemptIds.flatMap((id, index) => index % 7 === 0 ? [] : [{
    id: `project-${id}`, enterprise_attempt_id: id, challenge_id: challenge.id,
    submitted_at: index % 3 === 0 ? null : new Date('2026-01-01T00:00:00Z'),
    report: index % 5 === 0 ? null : { evaluationStatus: 'complete', outcome: 40, prompt: { score: 20 }, process: { score: 21 } },
  }]).reverse();
  return { attemptIds, rows };
}

if (process.argv[2] === '--sample') {
  const count = Number(process.argv[4]);
  assert.ok([100, 1000, 5000, 10_000].includes(count));
  const compare = process.argv[3] === 'before' ? baseline : buildEnterpriseVibeScores;
  const { attemptIds, rows } = fixture(count);
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const result = compare([challenge.id], attemptIds, rows);
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const digest = createHash('sha256').update(JSON.stringify([...result])).digest('hex');
  assert.equal(result.size, count);
  process.stdout.write(JSON.stringify({ elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, peakRssKiB: process.resourceUsage().maxRSS, digest }));
} else {
  const results = [];
  for (const count of [100, 1000, 5000, 10_000]) {
    const samples = { before: [], after: [] };
    for (let repeat = 0; repeat < 5; repeat++) for (const mode of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--sample', mode, String(count)], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(child.status, 0, child.stderr);
      samples[mode].push(JSON.parse(child.stdout));
    }
    assert.equal(new Set([...samples.before, ...samples.after].map((row) => row.digest)).size, 1, 'Both algorithms must return identical complete result payloads');
    const median = (values) => values.toSorted((a, b) => a - b)[2];
    const summarize = (rows) => Object.fromEntries(['elapsedMs', 'cpuMs', 'peakRssKiB'].map((key) => [key, median(rows.map((row) => row[key]))]));
    results.push({ candidates: count, projects: fixture(count).rows.length, before: summarize(samples.before), after: summarize(samples.after), samples });
  }
  process.stdout.write(JSON.stringify({ scope: 'Enterprise result assembly only; excludes SQL, HTTP and serialization time. Five fresh-process samples per mode, alternating order; identical output digests.', baseline: '6176015b63a1615cc2269172f246725ef08abab3', environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length }, results }, null, 2) + '\n');
}
