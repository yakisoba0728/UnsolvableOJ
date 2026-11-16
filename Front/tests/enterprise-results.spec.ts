import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { session, storageKey } from './fixtures';
import type { EnterpriseTest, TestResults } from '../src/enterprise/model';

const assessment: EnterpriseTest = {
  id: 'paged-results', title: '대규모 응시 결과', description: '',
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-02T00:00:00Z', durationMin: 30,
  problemIds: ['sum'], vibeChallengeIds: [], inviteCode: 'paged-results', inviteOnly: false,
  invitees: [], showScoreToCandidates: false, attemptCount: 103,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function resultPage(page: number, total = 103): TestResults {
  return {
    test: assessment,
    pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) },
    summary: { candidates: total, averageScore: total ? 100 : 0, perfect: total, pending: 0 },
    analytics: { finished: total, active: 0, expired: 0, scoreBands: [0, 0, 0, 0, total] },
    exportLimit: 5_000,
    candidates: Array.from({ length: Math.max(0, Math.min(50, total - (page - 1) * 50)) }, (_, index) => {
      const number = (page - 1) * 50 + index + 1;
      const id = `candidate-${number}`;
      return { id, startedAt: '2026-01-01T00:00:00Z', deadlineAt: '2026-01-01T00:30:00Z',
        finishedAt: '2026-01-01T00:20:00Z', user: { id, username: `응시자${String(number).padStart(3, '0')}` },
        solved: 1, score: 100,
        problems: [{ problemId: 'sum', solved: true, submissions: 2, submissionId: `submission-${number}` }],
      };
    }),
  };
}

async function setup(page: Page, savedSession = session) {
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
    key: storageKey, saved: { session: savedSession, expiresAt: Date.now() + 900_000 },
  });
  await page.route('**/api/v1/problems?*', (route) => route.fulfill({ json: { items: [], total: 0, totalPages: 0 } }));
  await page.route('**/api/v1/problems/mine', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/enterprise/tests/paged-results', (route) => route.fulfill({ json: assessment }));
  let failSecond = false;
  let delaySecond: Promise<void> | undefined;
  let candidateTotal = 103;
  const requests: number[] = [];
  await page.route(/\/api\/v1\/enterprise\/tests\/paged-results\/results(?:\?|$)/, async (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
    requests.push(number);
    if (number === 2 && failSecond) {
      failSecond = false;
      return route.fulfill({ status: 503, json: { message: '결과 조회를 잠시 사용할 수 없어요.' } });
    }
    if (number === 2 && delaySecond) await delaySecond;
    return route.fulfill({ json: resultPage(number, candidateTotal) });
  });
  return {
    requests,
    failNextPage() { failSecond = true; },
    delayNextPage(pending: Promise<void>) { delaySecond = pending; },
    setCandidateTotal(total: number) { candidateTotal = total; },
  };
}

test('keyboard pagination keeps global counts and focuses the result heading while loading bounded details', async ({ page }) => {
  const mock = await setup(page);
  await page.goto('/enterprise/paged-results');
  const section = page.getByRole('region', { name: '응시 결과', exact: true });
  await expect(section.locator('tbody tr')).toHaveCount(50);
  await expect(section.getByText(/전체 103명 중 1–50명/)).toBeVisible();
  await expect(page.getByRole('region', { name: '응시 현황' }).locator('.ent-summary').getByText('103명', { exact: true })).toHaveCount(2);
  await expect(section.getByRole('link', { name: '응시자001 1번 제출 보기' })).toHaveAttribute('href', '/submissions/submission-1');
  let release!: () => void;
  mock.delayNextPage(new Promise<void>((resolve) => { release = resolve; }));
  await section.getByRole('button', { name: '다음 결과' }).focus();
  await page.keyboard.press('Enter');
  await expect(section.getByRole('heading', { name: '응시 결과' })).toBeFocused();
  await expect(section).toHaveAttribute('aria-busy', 'true');
  await expect(section.getByText('결과를 불러오는 중…')).toBeVisible();
  await expect(section.getByRole('link', { name: '응시자001', exact: true })).toHaveCount(0);
  release();
  await expect(section.locator('tbody tr')).toHaveCount(50);
  await expect(section.getByText(/전체 103명 중 51–100명/)).toBeVisible();
  await expect(section.getByRole('link', { name: '응시자051', exact: true })).toBeVisible();
  await section.getByRole('button', { name: '다음 결과' }).click();
  await expect(section.locator('tbody tr')).toHaveCount(3);
  await expect(section.getByText(/전체 103명 중 101–103명/)).toBeVisible();
  await expect(section.getByRole('button', { name: '다음 결과' })).toBeDisabled();
  await section.getByRole('button', { name: '이전 결과' }).click();
  await expect(section.getByText(/전체 103명 중 51–100명/)).toBeVisible();
  expect(mock.requests).toEqual([1, 2, 3, 2]);
});

test('failed page requests expose retry and a first-page recovery without showing the previous page as new results', async ({ page }) => {
  const mock = await setup(page);
  await page.goto('/enterprise/paged-results');
  const section = page.getByRole('region', { name: '응시 결과', exact: true });
  await expect(section.locator('tbody tr')).toHaveCount(50);
  mock.failNextPage();
  await section.getByRole('button', { name: '다음 결과' }).click();
  await expect(section.getByRole('alert')).toContainText('결과 조회를 잠시 사용할 수 없어요.');
  await expect(section.locator('tbody tr')).toHaveCount(0);
  await section.getByRole('button', { name: '다시 시도' }).click();
  await expect(section.getByText(/전체 103명 중 51–100명/)).toBeVisible();
  await section.getByRole('button', { name: '이전 결과' }).click();
  await expect(section.getByText(/전체 103명 중 1–50명/)).toBeVisible();
  mock.failNextPage();
  await section.getByRole('button', { name: '다음 결과' }).click();
  await section.getByRole('button', { name: '첫 페이지로' }).click();
  await expect(section.getByText(/전체 103명 중 1–50명/)).toBeVisible();
});

test('small-screen result navigation keeps page labels and detail links accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/enterprise/paged-results');
  const navigation = page.getByRole('navigation', { name: '응시 결과 페이지' });
  await expect(navigation.getByRole('button', { name: '다음 결과' })).toBeVisible();
  await navigation.getByRole('button', { name: '다음 결과' }).click();
  await expect(page.getByText(/전체 103명 중 51–100명/)).toBeVisible();
  await expect(page.getByRole('link', { name: '응시자051 1번 제출 보기' })).toHaveAttribute('href', '/submissions/submission-51');
  await expect(navigation.getByRole('button', { name: '이전 결과' })).toBeEnabled();
});

for (const remaining of [1, 0]) {
  test(`a refreshed page that no longer exists offers keyboard recovery when ${remaining} candidates remain`, async ({ page }) => {
    const mock = await setup(page);
    await page.goto('/enterprise/paged-results');
    const section = page.getByRole('region', { name: '응시 결과', exact: true });
    await expect(section.locator('tbody tr')).toHaveCount(50);
    await section.getByRole('button', { name: '다음 결과' }).click();
    await expect(section.getByText(/전체 103명 중 51–100명/)).toBeVisible();
    mock.setCandidateTotal(remaining);
    await section.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(section.getByText(/응시자 목록이 변경되어 이 페이지에 표시할 결과가 없어요/)).toBeVisible();
    await expect(section.getByText(`전체 ${remaining}명`, { exact: true })).toBeVisible();
    await expect(section.locator('tbody tr')).toHaveCount(0);
    await expect(section.getByText(/2\/[01]페이지|0–1명/)).toHaveCount(0);
    await section.getByRole('button', { name: '첫 페이지로', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(section.getByRole('heading', { name: '응시 결과', exact: true })).toBeFocused();
    if (remaining) {
      await expect(section.locator('tbody tr')).toHaveCount(1);
      await expect(section.getByText(/전체 1명 중 1–1명 · 1\/1페이지/)).toBeVisible();
    } else {
      await expect(section.getByText('아직 응시한 사람이 없어요. 응시 링크를 보내 보세요.')).toBeVisible();
      await expect(section.locator('tbody tr')).toHaveCount(0);
    }
    await expect(section.getByRole('button', { name: '첫 페이지로' })).toHaveCount(0);
    expect(mock.requests).toEqual([1, 2, 2, 1]);
  });
}

const exportCsv = '\uFEFF"username","started_at_utc","deadline_at_utc","finished_at_utc","attempt_status","solved_algorithm_tasks","total_algorithm_tasks","score_0_100","evaluation_status"\r\n"exported-candidate","2026-01-01T00:00:00.000Z","2026-01-01T00:30:00.000Z","","EXPIRED","1","1","100","SCORED"\r\n';

test('keyboard downloads the whole-assessment CSV while viewing page two and shows global score bands', async ({ page }) => {
  await setup(page);
  const requests: string[] = [];
  await page.route('**/api/v1/enterprise/tests/paged-results/results/export', route => {
    requests.push(route.request().url());
    expect(route.request().headers().authorization).toBe(`Bearer ${session.accessToken}`);
    expect(route.request().headers().accept).toBe('text/csv');
    return route.fulfill({ contentType: 'text/csv; charset=utf-8', body: exportCsv });
  });
  await page.goto('/enterprise/paged-results');
  const section = page.getByRole('region', { name: '응시 결과', exact: true });
  await section.getByRole('button', { name: '다음 결과' }).click();
  await expect(section.getByText(/전체 103명 중 51–100명/)).toBeVisible();
  await expect(page.getByText('제출 종료 103명 · 시간 만료 0명 · 응시 중 0명')).toBeVisible();
  await expect(page.getByLabel('전체 응시자 점수 분포').getByText('103명', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: '전체 결과 CSV', exact: true }).focus();
  const pendingDownload = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('enterprise-results.csv');
  expect(await readFile((await download.path())!, 'utf8')).toBe(exportCsv);
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toContain('?page=');
  await expect(section.getByText(/전체 결과 CSV 다운로드를 시작했어요/)).toBeVisible();
});

test('mobile export failure remains explicit and can be retried without losing the current page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  let requests = 0;
  await page.route('**/api/v1/enterprise/tests/paged-results/results/export', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { message: 'CSV 생성이 잠시 지연됐어요.' } })
      : route.fulfill({ contentType: 'text/csv', body: exportCsv });
  });
  await page.goto('/enterprise/paged-results');
  const section = page.getByRole('region', { name: '응시 결과', exact: true });
  await section.getByRole('button', { name: '전체 결과 CSV', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('CSV 생성이 잠시 지연됐어요.');
  await expect(section.locator('tbody tr')).toHaveCount(50);
  const pendingDownload = page.waitForEvent('download');
  await section.getByRole('button', { name: 'CSV 다시 시도', exact: true }).click();
  await pendingDownload;
  await expect(section.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('export refuses silent truncation above the cap and handles an empty result set', async ({ page }) => {
  const mock = await setup(page);
  mock.setCandidateTotal(5_001);
  await page.goto('/enterprise/paged-results');
  await expect(page.getByRole('button', { name: '전체 결과 CSV', exact: true })).toBeDisabled();
  await expect(page.getByText(/한도를 초과해 내보낼 수 없어요/)).toBeVisible();
  mock.setCandidateTotal(0);
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByText('아직 응시한 사람이 없어요. 응시 링크를 보내 보세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '전체 결과 CSV', exact: true })).toBeEnabled();
});

test('an HTML fallback cannot be downloaded as a successful CSV', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/enterprise/tests/paged-results/results/export', route => route.fulfill({ contentType: 'text/html', body: '<html>Application fallback</html>' }));
  await page.goto('/enterprise/paged-results');
  await page.getByRole('button', { name: '전체 결과 CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('내보내기 응답을 확인하지 못했어요.');
});

test('a CSV 401 uses the normal token refresh and retries as text without losing download ownership', async ({ page }) => {
  const first = { ...session, refreshToken: 'csv-refresh-1', refreshTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), remember: true };
  await setup(page, first);
  const headers: string[] = [];
  await page.route('**/api/v1/auth/refresh', route => route.fulfill({
    json: { ...first, accessToken: 'fresh-csv-token', refreshToken: 'csv-refresh-2' },
  }));
  await page.route('**/api/v1/enterprise/tests/paged-results/results/export', route => {
    const token = route.request().headers().authorization;
    headers.push(token);
    return token === 'Bearer fresh-csv-token'
      ? route.fulfill({ contentType: 'text/csv', body: exportCsv })
      : route.fulfill({ status: 401, json: { message: '토큰 만료' } });
  });
  await page.goto('/enterprise/paged-results');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '전체 결과 CSV', exact: true }).click();
  await downloaded;
  expect(headers).toEqual([`Bearer ${session.accessToken}`, 'Bearer fresh-csv-token']);
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
});

for (const transition of ['account', 'navigation'] as const) {
  test(`a late CSV response cannot download after ${transition}`, async ({ page }) => {
    await setup(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route('**/api/v1/enterprise/tests/paged-results/results/export', async route => {
      requested = true;
      await held;
      await route.fulfill({ contentType: 'text/csv', body: exportCsv }).catch(() => {});
    });
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.goto('/enterprise/paged-results');
    await page.getByRole('button', { name: '전체 결과 CSV', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('button', { name: 'CSV 준비 중…', exact: true })).toBeDisabled();
    if (transition === 'account') {
      await page.route('**/api/v1/enterprise/tests/paged-results', route => route.fulfill({ status: 404, json: { message: '테스트를 찾을 수 없습니다.' } }));
      await page.evaluate(({ key, current }) => {
        const oldValue = localStorage.getItem(key);
        const next = { ...current, accessToken: 'another-account-token', user: { ...current.user, id: 'another-account', username: '다른계정' } };
        const newValue = JSON.stringify({ session: next, expiresAt: Date.now() + 900_000 });
        localStorage.setItem(key, newValue);
        window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }));
      }, { key: storageKey, current: session });
      await expect(page.getByText('테스트를 찾을 수 없어요')).toBeVisible();
    } else {
      await page.getByRole('link', { name: '기업 테스트', exact: true }).first().click();
      await expect(page).toHaveURL(/\/enterprise$/);
    }
    release();
    // Wait through React's cancellation and queued microtasks without a long sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(downloads).toBe(0);
    await expect(page.getByText(/전체 결과 CSV 다운로드를 시작했어요/)).toHaveCount(0);
  });
}
