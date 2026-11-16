import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const [worktree, probeDirectory, reportName = 'phase5-ux-dom.json'] = process.argv.slice(2);
if (!worktree || !probeDirectory || path.basename(reportName) !== reportName) {
  throw new Error('usage: node phase5-ux-dom-probe.mjs WORKTREE JSDOM_DIRECTORY [REPORT_BASENAME]');
}
const root = path.resolve(worktree);
const probe = path.resolve(probeDirectory);
const require = createRequire(path.join(root, 'Front/package.json'));
const probeRequire = createRequire(path.join(probe, 'package.json'));
const { JSDOM } = probeRequire('jsdom');
const jsdomVersion = probeRequire('jsdom/package.json').version;
const { build } = require('esbuild');
const bundle = path.join(probe, 'phase5-ux.cjs');
await build({
  stdin: { contents: `
    import React, { act, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AuthProvider } from './src/auth';
    import { DateTimePicker } from './src/components/DateTimePicker';
    import { LearningGoalPanel } from './src/learning/LearningGoalPanel';
    export { act };
    export function mount(kind) {
      let submits = 0;
      function DateForm() {
        const [value, setValue] = useState('2026-11-16T12:30');
        return <form onSubmit={event => { event.preventDefault(); submits++; }}>
          <label htmlFor="date">Start</label><DateTimePicker id="date" value={value} onChange={setValue}/>
          <input id="outside" aria-label="Outside" />
        </form>;
      }
      const app = createRoot(document.getElementById('root'));
      app.render(kind === 'goal' ? <AuthProvider><LearningGoalPanel/></AuthProvider> : <DateForm/>);
      return { app, submits: () => submits };
    }`, resolveDir: path.join(root, 'Front'), loader: 'tsx' },
  outfile: bundle, platform: 'node', bundle: true, format: 'cjs', jsx: 'automatic', logLevel: 'silent',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
});
const goal = {
  timeZone: 'Asia/Seoul', generatedAt: '2026-11-16T03:00:00.000Z',
  goal: { targetProblems: 1000, solvedProblems: 900, days: 30, status: 'ACTIVE',
    startDate: '2026-11-16', endDate: '2026-12-15', startsAt: '2026-11-15T15:00:00.000Z',
    endsAt: '2026-12-15T15:00:00.000Z', updatedAt: '2026-11-16T03:00:00.000Z' },
};
const report = {
  source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    diff: execFileSync('git', ['diff', '--', 'Front/src/components/DateTimePicker.tsx', 'Front/src/learning/LearningGoalPanel.tsx'], { cwd: root, encoding: 'utf8' }).trim() },
  node: process.version, jsdom: jsdomVersion, browser: false,
  limitations: 'DOM focus and content regression only. No layout, paint, native keyboard default actions, screenshots, accessibility certification or browser performance measurement.',
  cases: [],
};
for (const name of ['hour-enter', 'minute-enter', 'done', 'clear', 'escape', 'outside-focus', 'goal-refresh']) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/learning', pretendToBeVisual: true });
  const win = dom.window;
  for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'StorageEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'getComputedStyle']) {
    Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('unsolvable-oj-session-v1', JSON.stringify({ session: {
    accessToken: 'phase5-disposable-dom-token', tokenType: 'Bearer', expiresIn: '15m',
    user: { id: 'phase5-dom', username: 'phase5-dom', email: 'fixture@example.invalid', role: 'USER', level: 1, xp: 0, rating: 0 },
  }, expiresAt: Date.now() + 900000 }));
  let reads = 0, release;
  globalThis.fetch = async (url) => {
    if (new URL(url, 'http://localhost').pathname !== '/api/v1/users/me/learning-goal') return Response.json({ message: 'Unexpected fixture request' }, { status: 404 });
    if (++reads === 1) return Response.json(goal);
    return new Promise(resolve => { release = () => resolve(Response.json(goal)); });
  };
  delete require.cache[bundle];
  const { mount, act } = require(bundle);
  let mounted;
  const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const wait = async (condition) => {
    for (let index = 0; index < 100; index++) { if (condition()) return; await tick(); }
    throw new Error('Bounded DOM fixture did not settle');
  };
  const observed = {};
  try {
    await act(async () => { mounted = mount(name === 'goal-refresh' ? 'goal' : 'date'); });
    if (name === 'goal-refresh') {
      await wait(() => document.querySelector('.learning-goal-count'));
      observed.beforeCount = document.querySelector('.learning-goal-count strong').textContent;
      await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '목표 새로고침').click(); });
      await wait(() => release);
      observed.duringCount = document.querySelector('.learning-goal-count strong')?.textContent ?? null;
      observed.busy = document.querySelector('.learning-goal').getAttribute('aria-busy');
      observed.disabled = [...document.querySelectorAll('button')].find(button => button.textContent === '목표 변경').disabled;
      await act(async () => { release(); });
      await wait(() => document.querySelector('.learning-goal').getAttribute('aria-busy') === 'false');
      assert.equal(observed.duringCount, observed.beforeCount);
      assert.equal(observed.busy, 'true');
      assert.equal(observed.disabled, true);
    } else {
      const trigger = document.querySelector('#date');
      await act(async () => { trigger.focus(); trigger.click(); });
      const dialog = document.querySelector('[role="dialog"]');
      assert.ok(dialog);
      if (['hour-enter', 'minute-enter', 'escape'].includes(name)) {
        const field = dialog.querySelector(`[aria-label="${name === 'hour-enter' ? '시' : '분'}"]`);
        await act(async () => {
          field.focus();
          field.dispatchEvent(new KeyboardEvent('keydown', { key: name === 'escape' ? 'Escape' : 'Enter', bubbles: true, cancelable: true }));
        });
      } else if (name === 'outside-focus') {
        await act(async () => document.querySelector('#outside').focus());
      } else {
        const button = [...dialog.querySelectorAll('button')].find(item => item.textContent === (name === 'done' ? '확인' : '삭제'));
        await act(async () => { button.focus(); button.click(); });
      }
      observed.dialogClosed = !document.querySelector('[role="dialog"]');
      observed.focusId = document.activeElement.id;
      observed.focusTag = document.activeElement.tagName;
      observed.submits = mounted.submits();
      assert.equal(observed.dialogClosed, true);
      assert.equal(observed.focusId, name === 'outside-focus' ? 'outside' : 'date');
      assert.equal(observed.submits, 0);
    }
    report.cases.push({ name, passed: true, observed });
  } catch (error) {
    report.cases.push({ name, passed: false, observed, error: String(error) });
  } finally {
    if (mounted) await act(async () => mounted.app.unmount());
    dom.window.close();
  }
}
await fs.writeFile(path.join(probe, reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
// Every app has been unmounted and every window closed; the finite diagnostic
// must not wait on incidental Node fetch/React background handles.
process.exit(report.cases.every(item => item.passed) ? 0 : 1);
