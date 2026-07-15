import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const config = {
  openRouterDefaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaults: ['alpha/model', 'beta/model', 'chair/model'],
  criteria: [
    { id: 'correctness', label: 'Korrektheit', defaultWeight: 1 },
    { id: 'depth', label: 'Tiefe', defaultWeight: 1 },
    { id: 'utility', label: 'Praxisnutzen', defaultWeight: 1 }
  ]
};

const completedRun = {
  id: 'run-new', started_at: '2026-07-15T12:00:00Z', stage: 'complete', status: 'completed', revealed_at: '2026-07-15T12:00:05Z',
  responses: [{ model: 'alpha/model', anonymous_id: 'Response A', status: 'success', content: '# Antwort', latency_ms: 20, total_tokens: 12 }],
  reviews: [], ranking: [{ rank: 1, responseId: 'Response A', model: 'alpha/model', weightedScore: 9, validVotes: 2 }],
  final_answer: '# Synthese', summary: { durationMs: 100, modelCalls: 3, successfulCalls: 3, failedCalls: 0, tokenTotals: { total: 20 } }
};

async function mockApi(page, { failInitial = false } = {}) {
  let failed = failInitial;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (failed && url.pathname === '/api/config') {
      failed = false;
      return route.fulfill({ status: 500, json: { error: 'kaputt' } });
    }
    if (url.pathname === '/api/config') return route.fulfill({ json: config });
    if (url.pathname === '/api/conversations') return route.fulfill({ json: { conversations: [{ id: 'conv-1', title: 'Gespeicherte Analyse', latest_status: 'completed' }] } });
    if (url.pathname === '/api/conversations/conv-1') return route.fulfill({ json: { conversation: { id: 'conv-1', runs: [{ ...completedRun, id: 'run-old', started_at: '2026-07-14T12:00:00Z' }, completedRun] } } });
    return route.fulfill({ status: 200, json: { ok: true } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('LLM Council Analyse');
});

test('Modellkennung behält Fokus und vollständigen Wert', async ({ page }) => {
  const input = page.getByLabel('Modellkennung 1');
  await input.click();
  await input.pressSequentially('/extended', { delay: 5 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('alpha/model/extended');
});

test('Conversation-History ist vollständig per Tastatur bedienbar', async ({ page }) => {
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // new conversation
  await page.keyboard.press('Tab'); // history entry
  await expect(page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synthese', { exact: true }).last()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Conversation.*löschen/ })).toBeFocused();
});

test('Wiederöffnung setzt Endphase und Export auf den neuesten Lauf', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await expect(page.getByRole('link', { name: /Export/ })).toHaveAttribute('href', '/api/runs/run-new/export.md');
  await expect(page.locator('[aria-current="step"]')).toContainText('5 Synthese');
  await expect(page.locator('h1')).toHaveCount(1);
});

test('Neue Conversation entfernt alten Run-, Export- und Ergebniszustand', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await expect(page.getByRole('link', { name: /Export/ })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Conversation' }).click();
  await expect(page.getByRole('link', { name: /Export/ })).toHaveCount(0);
  await expect(page.locator('.final').getByText('Synthese', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Frage an das Council')).toHaveValue('');
});

for (const width of [320, 390, 430]) {
  test(`Viewport ${width}px hat keinen Dokumentoverflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    await expect(page.getByRole('list', { name: 'Laufphasen' }).getByRole('listitem')).toHaveCount(5);
  });
}

test('Axe: Initialzustand und wiedergeöffneter Lauf ohne ernste Verstöße', async ({ page }) => {
  const initial = await new AxeBuilder({ page }).analyze();
  expect(initial.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  const reopened = await new AxeBuilder({ page }).analyze();
  expect(reopened.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});

test('Live-Regionen melden Phasen-, Council-, Modell- und Abschlussstatus gezielt', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();

  const phaseStatus = page.getByTestId('phase-live-status');
  await expect(phaseStatus).toHaveAttribute('role', 'status');
  await expect(phaseStatus).toHaveAttribute('aria-live', 'polite');
  await expect(phaseStatus).toContainText('Aktuelle Phase: 5 Synthese');

  const councilStatus = page.getByTestId('council-live-status');
  await expect(councilStatus).toHaveAttribute('aria-atomic', 'true');
  await expect(councilStatus).toContainText('1 von 1 Council-Antworten abgeschlossen');

  const modelStatus = page.getByRole('status', { name: 'Response A: fertig' });
  await expect(modelStatus).toHaveAttribute('aria-live', 'polite');
  await expect(modelStatus).toHaveText('fertig');

  const completionStatus = page.getByTestId('run-complete-status');
  await expect(completionStatus).toHaveAttribute('role', 'status');
  await expect(completionStatus).toContainText('Council-Lauf abgeschlossen');
});
