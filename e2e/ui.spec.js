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
  responses: [
    { model: 'alpha/model', anonymous_id: 'Response A', status: 'success', content: '### Tiefenanalyse\n\nAntwort A mit ausführlichem Inhalt.\n\n'.repeat(12), latency_ms: 20, total_tokens: 12 },
    { model: 'beta/model', anonymous_id: 'Response B', status: 'success', content: '## Alternative\n\nAntwort B mit einem anderen Ansatz.\n\n'.repeat(12), latency_ms: 30, total_tokens: 14 }
  ],
  reviews: [{ reviewer_model: 'beta/model', status: 'success', review: { responses: [{ responseId: 'Response A', scores: { correctness: 9, depth: 8, utility: 9 }, rationale: 'Sehr schlüssig.', strengths: ['Präzise'], weaknesses: ['Knapp'] }], ranking: ['Response A', 'Response B'] } }],
  ranking: [{ rank: 1, responseId: 'Response A', model: 'alpha/model', weightedScore: 9, validVotes: 2 }, { rank: 2, responseId: 'Response B', model: 'beta/model', weightedScore: 8, validVotes: 2 }],
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
  await expect(councilStatus).toContainText('2 von 2 Council-Antworten abgeschlossen');

  await page.getByRole('tab', { name: 'Antworten' }).click();
  const modelStatus = page.getByRole('status', { name: 'Response A: fertig' });
  await expect(modelStatus).toHaveAttribute('aria-live', 'polite');
  await expect(modelStatus).toHaveText('fertig');

  const completionStatus = page.getByTestId('run-complete-status');
  await expect(completionStatus).toHaveAttribute('role', 'status');
  await expect(completionStatus).toContainText('Council-Lauf abgeschlossen');
});

test('Synthese ist aktiv und Ergebnis-Tabs folgen dem Tastaturmuster', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  const synthesis = page.getByRole('tab', { name: 'Synthese' });
  await expect(synthesis).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Synthese' })).toBeVisible();
  await synthesis.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Antworten' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Laufdaten' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(synthesis).toBeFocused();
});

test('zwei Antworten lassen sich auswählen und vergleichen', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await page.getByRole('tab', { name: 'Antworten' }).click();
  await page.getByRole('checkbox', { name: 'Response A' }).check();
  await page.getByRole('checkbox', { name: 'Response B' }).check();
  await expect(page.getByTestId('answer-comparison').locator('article')).toHaveCount(2);
});

test('Reviews sind strukturiert, technische Details standardmäßig geschlossen', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await page.getByRole('tab', { name: 'Bewertungen' }).click();
  await expect(page.getByText('9/10').first()).toBeVisible();
  const technical = page.getByText('Technische Details').locator('..');
  await expect(technical).not.toHaveAttribute('open', '');
  await expect(page.locator('.technical pre')).not.toBeVisible();
});

test('Desktop-Konfiguration klappt beim Laufstart ein und bleibt wieder erreichbar', async ({ page }) => {
  await page.route('**/api/runs', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"type":"run_complete","runId":"run-live","stage":"synthesis"}\n\n'
  }));
  await page.getByLabel('Frage an das Council').fill('Analysiere diese Frage.');
  await expect(page.getByRole('complementary', { name: 'Laufkonfiguration' })).toBeVisible();
  await page.getByRole('button', { name: 'Lauf starten' }).click();
  await expect(page.getByRole('complementary', { name: 'Laufkonfiguration' })).toBeHidden();
  const reopen = page.getByRole('button', { name: 'Konfiguration öffnen' }).last();
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('complementary', { name: 'Laufkonfiguration' })).toBeVisible();
});

test('Mobile Drawer sind modal, halten Fokus fest und geben ihn exakt zurück', async ({ page }) => {
  const desktopToggle = page.getByRole('button', { name: 'Konfiguration schließen' });
  await desktopToggle.click();
  await expect(page.getByRole('complementary', { name: 'Laufkonfiguration' })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 850 });
  const historyTrigger = page.getByRole('button', { name: 'Historie öffnen' });
  await historyTrigger.click();
  const historyDrawer = page.getByRole('dialog', { name: 'Conversation-Historie' });
  await expect(historyDrawer).toHaveAttribute('aria-modal', 'true');
  const historyClose = page.getByRole('button', { name: 'Historie schließen' });
  await expect(historyClose).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: /Conversation.*löschen/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(historyClose).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(historyTrigger).toBeFocused();
  await historyTrigger.click();
  const backdrop = page.locator('.drawerBackdrop');
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  await expect(backdrop).not.toHaveAttribute('tabindex', '0');
  await backdrop.click({ position: { x: 380, y: 400 } });
  await expect(historyTrigger).toBeFocused();
  const configTrigger = page.getByRole('button', { name: 'Konfiguration öffnen' }).first();
  await configTrigger.click();
  const configDrawer = page.getByRole('dialog', { name: 'Laufkonfiguration' });
  await expect(configDrawer).toHaveAttribute('aria-modal', 'true');
  const configClose = page.getByRole('button', { name: 'Konfiguration schließen' });
  await expect(configClose).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('Gewichtung für Praxisnutzen')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(configClose).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(configTrigger).toBeFocused();
});

test('frischer mobiler Konfigurationsdrawer gibt Backdrop-Fokus an den Header-Auslöser zurück', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('LLM Council Analyse');

  const trigger = page.getByTestId('mobile-config-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const drawer = page.getByRole('dialog', { name: 'Laufkonfiguration' });
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('button', { name: 'Konfiguration schließen' })).toBeFocused();

  await page.locator('.drawerBackdrop').click({ position: { x: 10, y: 400 } });
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Desktop-History gibt beim Einklappen ihre Grid-Breite vollständig frei', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sidebar = page.locator('aside.sidebar');
  const toggle = page.getByRole('button', { name: 'Historie schließen' });
  const widthBefore = await page.locator('main.workspace').evaluate((node) => node.getBoundingClientRect().width);
  await toggle.click();
  const reopen = page.getByRole('button', { name: 'Historie öffnen' });
  await expect(reopen).toBeFocused();
  await expect(reopen).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toBeHidden();
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect.poll(() => page.locator('main.workspace').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 200);
  await expect(page.getByRole('button', { name: /^Gespeicherte Analyse/ })).toHaveCount(0);
  await reopen.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: /^Gespeicherte Analyse/ })).toBeEnabled();
});

test('Mobile Drawer isolieren den Produktions-DOM symmetrisch und entfernen Isolation beim Schließen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('LLM Council Analyse');
  const background = ['.skipLink', 'header.mobileBar', 'main.workspace'];
  const assertInert = async (selectors, expected) => {
    for (const selector of selectors) {
      const state = await page.locator(selector).evaluate((node) => ({ attribute: node.hasAttribute('inert'), property: node.inert }));
      expect(state).toEqual({ attribute: expected, property: expected });
    }
  };

  const configTrigger = page.getByTestId('mobile-config-trigger');
  await configTrigger.click();
  await assertInert([...background, 'aside.sidebar'], true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: 'Laufkonfiguration' }).locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await assertInert(background, false);
  await expect(configTrigger).toBeFocused();

  const historyTrigger = page.getByRole('button', { name: 'Historie öffnen' });
  await historyTrigger.click();
  await assertInert([...background, 'aside.configRail'], true);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('dialog', { name: 'Conversation-Historie' }).locator(':focus')).toHaveCount(1);
  await page.locator('.drawerBackdrop').click({ position: { x: 385, y: 400 } });
  await assertInert(background, false);
  await expect(historyTrigger).toBeFocused();
});

test('Markdown-### wahrt genau ein h1 und verletzt die Heading-Reihenfolge nicht', async ({ page }) => {
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await page.getByRole('tab', { name: 'Antworten' }).click();
  await expect(page.locator('h1')).toHaveCount(1);
  const result = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
  expect(result.violations).toEqual([]);
});

test('mobile Vergleichsansicht stapelt und langer Lauf bleibt kompakt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByRole('button', { name: 'Historie öffnen' }).click();
  await page.getByRole('button', { name: /^Gespeicherte Analyse abgeschlossen$/ }).click();
  await page.getByRole('tab', { name: 'Antworten' }).click();
  await page.getByRole('checkbox', { name: 'Response A' }).check();
  await page.getByRole('checkbox', { name: 'Response B' }).check();
  const cards = page.getByTestId('answer-comparison').locator('article');
  const boxes = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 2);
  await page.getByRole('tab', { name: 'Synthese' }).click();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height).toBeLessThan(5000);
});
