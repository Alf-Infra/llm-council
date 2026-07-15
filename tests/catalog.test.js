import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterCatalog, callPlan, estimateCost, parseCatalog, validatePresets } from '../server/catalog.js';

const model = (id, extra = {}) => ({ id, canonical_slug: `${id}@stable`, name: id, context_length: 128000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['temperature'], pricing: { prompt: '0.000001', completion: '0.000002', request: '0' }, ...extra });
const response = (data, { ok = true, status = 200 } = {}) => new Response(JSON.stringify({ data }), { status: ok ? status : status, headers: { 'content-type': 'application/json' } });

test('catalog validates schema, keeps only text output and projects safe fields', () => {
  const result = parseCatalog({ data: [model('openai/alpha'), model('vendor/image', { architecture: { output_modalities: ['image'] } }), { nope: true }] });
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]).sort(), ['canonicalSlug', 'contextLength', 'description', 'expiresAt', 'id', 'inputModalities', 'name', 'outputModalities', 'pricing', 'supportedParameters'].sort());
  assert.equal(result[0].pricing.prompt, 0.000001);
});

test('catalog caches, refreshes and serves a marked stale cache on upstream failure', async () => {
  let calls = 0;
  let clock = 1000;
  const catalog = new OpenRouterCatalog({ now: () => clock, ttlMs: 10, fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://openrouter.ai/api/v1/models');
    assert.equal(options.headers.authorization, undefined);
    if (calls === 1) return response([model('openai/alpha')]);
    throw new Error('offline secret sk-nope');
  } });
  assert.equal((await catalog.getModels()).stale, false);
  assert.equal((await catalog.getModels()).models.length, 1);
  assert.equal(calls, 1);
  clock += 20;
  const stale = await catalog.getModels();
  assert.equal(stale.stale, true);
  assert.doesNotMatch(JSON.stringify(stale), /sk-nope/);
});

test('catalog rejects oversized upstream data and unavailable cache', async () => {
  const catalog = new OpenRouterCatalog({ maxBytes: 10, fetchImpl: async () => new Response('12345678901') });
  await assert.rejects(() => catalog.getModels(), /nicht verfügbar/);
});

test('selection validation requires complete available non-expired slugs and resolves canonical slug', async () => {
  const catalog = new OpenRouterCatalog({ fetchImpl: async () => response([model('openai/alpha'), model('old/model', { expiration_date: '2020-01-01T00:00:00Z' })]) });
  const results = await catalog.validateSelection(['alpha', 'missing/model', 'old/model', 'openai/alpha']);
  assert.deepEqual(results.map((item) => item.ok), [false, false, false, true]);
  assert.equal(results[3].canonicalSlug, 'openai/alpha@stable');
});

test('preset availability, call formulas and price estimates are deterministic', () => {
  assert.deepEqual(callPlan('standard', 3), { mode: 'standard', baseCalls: 7, repairCallsMax: 3 });
  assert.deepEqual(callPlan('iterative', 3), { mode: 'iterative', baseCalls: 13, repairCallsMax: 6 });
  assert.equal(validatePresets([]).every((preset) => !preset.available), true);
  const prices = { a: { prompt: 1e-6, completion: 2e-6, request: 0 }, b: { prompt: 1e-6, completion: 2e-6, request: 0 }, c: { prompt: 1e-6, completion: 2e-6, request: 0 } };
  const estimate = estimateCost({ mode: 'standard', councilModels: ['a', 'b'], chairmanModel: 'c', prices });
  assert.equal(estimate.available, true);
  assert.equal(estimate.baseCalls, 5);
  assert.ok(estimate.estimatedUsd > 0);
  assert.equal(estimateCost({ mode: 'standard', councilModels: ['unknown'], chairmanModel: 'c', prices }).estimatedUsd, null);
});
