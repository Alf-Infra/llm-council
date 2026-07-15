import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadRuntimeConfig } from '../server/config.js';
import { CouncilStore, createDb } from '../server/db.js';
import { CouncilOrchestrator } from '../server/orchestrator.js';
import { OpenAICompatibleProvider } from '../server/provider.js';

const criteria = [
  { id: 'correctness', label: 'Korrektheit', weight: 1 },
  { id: 'depth', label: 'Tiefe', weight: 1 },
  { id: 'usefulness', label: 'Praxisnutzen', weight: 1 }
];

class FakeProvider {
  constructor(map) {
    this.map = map;
    this.calls = [];
  }

  async chat({ model, provider, messages }) {
    this.calls.push({ model, provider, messages });
    const script = this.map[model] || [];
    const next = Array.isArray(script) ? script.shift() : script;
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next({ model, provider, messages });
    return {
      content: next || `answer from ${model}`,
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      latencyMs: 5
    };
  }
}

test('health and safe config endpoints work without model calls', async () => {
  const app = createApp({
    dbPath: path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`),
    config: loadRuntimeConfig({ LLM_API_KEY: 'super-secret' }),
    provider: { chat: async () => { throw new Error('should not call provider'); } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.deepEqual(health, { ok: true });
    const config = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.equal(JSON.stringify(config).includes('super-secret'), false);
    assert.ok(Array.isArray(config.defaults));
  } finally {
    server.close();
  }
});

test('POST request body close does not abort an open SSE run', async () => {
  const orchestrator = {
    async *run(_input, signal) {
      yield { type: 'run_started', runId: 'run_normal_body_close' };
      yield { type: 'stage', runId: 'run_normal_body_close', stage: 'answers' };
      await delay(50);
      assert.equal(signal.aborted, false);
      yield { type: 'run_complete', runId: 'run_normal_body_close' };
    }
  };
  const app = createApp({
    dbPath: path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`),
    config: loadRuntimeConfig(),
    provider: { chat: async () => { throw new Error('should not call provider'); } },
    orchestrator,
    catalog: permissiveCatalog()
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRunRequest())
    });
    assert.equal(response.status, 200);
    const events = parseSse(await response.text());
    assert.deepEqual(events.map((event) => event.type), ['run_started', 'stage', 'run_complete']);
  } finally {
    server.close();
  }
});

test('POST /api/runs validates every council model and chairman before side effects', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-validation-${Date.now()}-${Math.random()}.db`)));
  const checked = [];
  let orchestratorCalls = 0;
  const catalog = {
    async validateSelection(ids) {
      checked.push(...ids);
      return ids.map((id) => ({
        requestedId: id,
        ok: id !== 'vendor/expired',
        canonicalSlug: id === 'vendor/expired' ? null : `${id}@canonical`,
        error: id === 'vendor/expired' ? 'Modell ist abgelaufen.' : null
      }));
    }
  };
  const app = createApp({
    config: loadRuntimeConfig(),
    store,
    catalog,
    provider: { chat: async () => { throw new Error('provider must not be called'); } },
    orchestrator: { async *run() { orchestratorCalls += 1; yield { type: 'run_complete' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = openRouterRunRequest('ephemeral-key');
    request.councilModels[1].model = 'vendor/expired';
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.deepEqual(checked, ['openrouter/a', 'vendor/expired', 'openrouter/chair']);
    assert.equal(body.results.length, 3);
    assert.equal(body.results[1].error, 'Modell ist abgelaufen.');
    assert.equal(orchestratorCalls, 0);
    assert.deepEqual(store.listConversations(), []);
    assert.doesNotMatch(JSON.stringify(body), /ephemeral-key/);
  } finally {
    server.close();
  }
});

test('POST /api/runs starts only after the complete catalog selection is valid', async () => {
  let checked = null;
  let receivedInput = null;
  const app = createApp({
    dbPath: path.join(os.tmpdir(), `llm-council-valid-selection-${Date.now()}-${Math.random()}.db`),
    config: loadRuntimeConfig(),
    catalog: { async validateSelection(ids) { checked = ids; return ids.map((id) => ({ requestedId: id, ok: true, canonicalSlug: id })); } },
    provider: { chat: async () => { throw new Error('unused'); } },
    orchestrator: { async *run(input) { receivedInput = input; yield { type: 'run_started', runId: 'validated-run' }; yield { type: 'run_complete', runId: 'validated-run' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openRouterRunRequest('temporary'))
    });
    assert.equal(response.status, 200);
    assert.deepEqual(checked, ['openrouter/a', 'openrouter/b', 'openrouter/chair']);
    assert.equal(receivedInput.councilModels.length, 2);
    assert.equal(receivedInput.chairmanModel.model, 'openrouter/chair');
    assert.deepEqual(parseSse(await response.text()).map((event) => event.type), ['run_started', 'run_complete']);
  } finally {
    server.close();
  }
});

test('POST /api/runs rejects stale catalog validation before every side effect', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-stale-${Date.now()}-${Math.random()}.db`)));
  let orchestratorCalls = 0;
  const catalog = {
    async validateSelection(ids, options) {
      assert.deepEqual(options, { requireFresh: true });
      const results = ids.map((id) => ({ requestedId: id, ok: true, canonicalSlug: id, model: { pricing: {} } }));
      Object.defineProperty(results, 'stale', { value: true });
      return results;
    }
  };
  const app = createApp({
    config: loadRuntimeConfig(), store, catalog,
    provider: { chat: async () => { throw new Error('provider must not be called'); } },
    orchestrator: { async *run() { orchestratorCalls += 1; yield { type: 'run_complete' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openRouterRunRequest('temporary'))
    });
    assert.equal(response.status, 503);
    assert.equal(orchestratorCalls, 0);
    assert.deepEqual(store.listConversations(), []);
  } finally {
    server.close();
  }
});

test('POST /api/runs canonicalizes every model and creates prices only from server catalog data', async () => {
  let receivedInput;
  const serverPrices = [
    { prompt: 0.000001, completion: 0.000002, request: 0.01 },
    { prompt: 0.000003, completion: null, request: 0 },
    { prompt: 0.000004, completion: 0.000005, request: null }
  ];
  const canonical = ['vendor/a-stable', 'vendor/b-stable', 'vendor/chair-stable'];
  const catalog = {
    async validateSelection(ids) {
      const results = ids.map((requestedId, index) => ({ requestedId, ok: true, canonicalSlug: canonical[index], model: { pricing: serverPrices[index] } }));
      Object.defineProperty(results, 'catalogTimestamp', { value: '2026-07-15T12:00:00.000Z' });
      return results;
    }
  };
  const app = createApp({
    dbPath: path.join(os.tmpdir(), `llm-council-canonical-${Date.now()}-${Math.random()}.db`),
    config: loadRuntimeConfig(), catalog,
    provider: { chat: async () => { throw new Error('unused'); } },
    orchestrator: { async *run(input) { receivedInput = input; yield { type: 'run_complete', runId: 'canonical-run' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const request = openRouterRunRequest('temporary');
    request.priceSnapshot = {
      'openrouter/a': { prompt: 999, completion: 999, request: 999, apiKey: 'client-price-secret' },
      'vendor/a-stable': { prompt: 888 }
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(receivedInput.councilModels.map((item) => item.model), canonical.slice(0, 2));
    assert.equal(receivedInput.chairmanModel.model, canonical[2]);
    assert.deepEqual(receivedInput.priceSnapshot['vendor/a-stable'], {
      canonicalSlug: 'vendor/a-stable', prompt: 0.000001, completion: 0.000002, request: 0.01,
      capturedAt: '2026-07-15T12:00:00.000Z', currency: 'USD', unit: 'per_token_and_request'
    });
    assert.equal(receivedInput.priceSnapshot['vendor/b-stable'].completion, null);
    assert.doesNotMatch(JSON.stringify(receivedInput.priceSnapshot), /999|888|client-price-secret/);
  } finally {
    server.close();
  }
});

test('POST /api/runs rejects a non-canonicalizable model without side effects', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-no-canonical-${Date.now()}-${Math.random()}.db`)));
  let orchestratorCalls = 0;
  const app = createApp({
    config: loadRuntimeConfig(), store,
    catalog: { async validateSelection(ids) { return ids.map((id, index) => ({ requestedId: id, ok: true, canonicalSlug: index === 1 ? null : id })); } },
    provider: { chat: async () => { throw new Error('provider must not be called'); } },
    orchestrator: { async *run() { orchestratorCalls += 1; yield { type: 'run_complete' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openRouterRunRequest('temporary'))
    });
    assert.equal(response.status, 422);
    assert.equal(orchestratorCalls, 0);
    assert.deepEqual(store.listConversations(), []);
  } finally {
    server.close();
  }
});

test('POST /api/runs rejects distinct council aliases resolving to one canonical model before side effects', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-canonical-duplicate-${Date.now()}-${Math.random()}.db`)));
  let orchestratorCalls = 0;
  const app = createApp({
    config: loadRuntimeConfig(), store,
    catalog: { async validateSelection(ids) {
      return ids.map((id, index) => ({ requestedId: id, ok: true, canonicalSlug: index < 2 ? 'vendor/shared' : 'vendor/chair', model: { pricing: {} } }));
    } },
    provider: { chat: async () => { throw new Error('provider must not be called'); } },
    orchestrator: { async *run() { orchestratorCalls += 1; yield { type: 'run_complete' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openRouterRunRequest('temporary'))
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Council-Modelle.*Alias-Auflösung.*eindeutig/);
    assert.equal(orchestratorCalls, 0);
    assert.deepEqual(store.listConversations(), []);
  } finally {
    server.close();
  }
});

test('POST /api/runs rejects chairman alias resolving to a council canonical model before side effects', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-canonical-chair-${Date.now()}-${Math.random()}.db`)));
  let orchestratorCalls = 0;
  const app = createApp({
    config: loadRuntimeConfig(), store,
    catalog: { async validateSelection(ids) {
      const canonical = ['vendor/a', 'vendor/b', 'vendor/a'];
      return ids.map((id, index) => ({ requestedId: id, ok: true, canonicalSlug: canonical[index], model: { pricing: {} } }));
    } },
    provider: { chat: async () => { throw new Error('provider must not be called'); } },
    orchestrator: { async *run() { orchestratorCalls += 1; yield { type: 'run_complete' }; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openRouterRunRequest('temporary'))
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Chairman-Modell.*Alias-Auflösung.*getrennt/);
    assert.equal(orchestratorCalls, 0);
    assert.deepEqual(store.listConversations(), []);
  } finally {
    server.close();
  }
});

test('real SSE client disconnect aborts and persists a running council run', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`)));
  const provider = {
    async chat({ signal }) {
      await new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason || new Error('aborted'));
        signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
      });
    }
  };
  const orchestrator = new CouncilOrchestrator({ provider, store });
  const app = createApp({
    config: loadRuntimeConfig(),
    store,
    provider,
    orchestrator,
    catalog: permissiveCatalog()
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const runId = await postRunAndDisconnect(server.address().port);
  try {
    const run = await waitForRunStatus(store, runId, 'aborted');
    assert.equal(run.status, 'aborted');
    assert.equal(run.stage, 'complete');
    assert.ok(run.completed_at);
  } finally {
    server.close();
  }
});

test('export during reviews is blocked and does not leak anonymized mapping', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`)));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const app = createApp({ config: loadRuntimeConfig(), store, provider, orchestrator });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const iterator = orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal);
  let runId;
  let conversationId;

  try {
    while (true) {
      const next = await iterator.next();
      assert.equal(next.done, false);
      const event = next.value;
      runId ||= event.runId;
      conversationId ||= event.conversationId;
      if (event.type === 'model_status' && event.stage === 'answers' && event.status === 'running') provider.resolve(event.model, `Antwort ${event.model}`);
      if (event.type === 'stage' && event.stage === 'reviews') break;
    }

    const exportResponse = await fetch(`${base}/api/runs/${runId}/export.md`);
    const exportBody = await exportResponse.text();
    assert.equal(exportResponse.status, 409);
    assert.equal(exportBody.includes('Antwort a'), false);
    assert.equal(exportBody.includes('Antwort b'), false);
    assert.equal(exportBody.includes('Response A'), false);

    const detail = await fetch(`${base}/api/conversations/${conversationId}`).then((r) => r.json());
    const activeRun = detail.conversation.runs[0];
    assert.equal(activeRun.revealed_at, null);
    assert.equal(activeRun.responses.some((item) => item.model && item.content && item.anonymous_id), false);
  } finally {
    for (const pending of [...provider.pending]) provider.reject(pending.model, new Error('stop'));
    await iterator.return?.();
    server.close();
  }
});

test('detail API and export stay hidden between ranking persistence and reveal', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`)));
  const provider = new DeferredProvider();
  let pause;
  const paused = new Promise((resolve) => {
    pause = createPause(resolve);
  });
  const orchestrator = new CouncilOrchestrator({
    provider,
    store,
    randomSeedFactory: () => 'fixed',
    hooks: { afterRankingSaved: pause.wait }
  });
  const app = createApp({ config: loadRuntimeConfig(), store, provider, orchestrator });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = [];

  try {
    const runPromise = consumeRun(orchestrator, provider, events);
    const pausedRun = await paused;
    const hiddenDetail = await fetch(`${base}/api/conversations/${pausedRun.conversationId}`).then((r) => r.json());
    const hiddenRun = hiddenDetail.conversation.runs[0];
    assert.equal(hiddenRun.revealed_at, null);
    assert.ok(hiddenRun.ranking.every((item) => !item.model));
    assert.equal(hiddenRun.responses.some((item) => item.model && item.content && item.anonymous_id), false);

    const exportResponse = await fetch(`${base}/api/runs/${pausedRun.runId}/export.md`);
    assert.equal(exportResponse.status, 409);

    pause.release();
    await runPromise;
  } finally {
    server.close();
  }
});

test('ranking SSE stays anonymous until answers_revealed commits the reveal', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`)));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const app = createApp({ config: loadRuntimeConfig(), store, provider, orchestrator });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const iterator = orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal);
  let rankingEvent;

  try {
    while (!rankingEvent) {
      const next = await iterator.next();
      assert.equal(next.done, false);
      const event = next.value;
      if (event.type === 'model_status' && event.stage === 'answers' && event.status === 'running') provider.resolve(event.model, `Antwort ${event.model}`);
      if (event.type === 'model_status' && event.stage === 'reviews' && event.status === 'running') provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
      if (event.type === 'ranking') rankingEvent = event;
    }

    assert.ok(rankingEvent.ranking.every((item) => item.responseId && !item.model));
    const hiddenDetail = await fetch(`${base}/api/conversations/${rankingEvent.conversationId}`).then((r) => r.json());
    const hiddenRun = hiddenDetail.conversation.runs[0];
    assert.equal(hiddenRun.revealed_at, null);
    assert.ok(hiddenRun.ranking.every((item) => !item.model));
    assert.equal(hiddenRun.responses.some((item) => item.model && item.content && item.anonymous_id), false);

    const hiddenExport = await fetch(`${base}/api/runs/${rankingEvent.runId}/export.md`);
    assert.equal(hiddenExport.status, 409);

    const revealNext = await iterator.next();
    assert.equal(revealNext.done, false);
    assert.equal(revealNext.value.type, 'answers_revealed');
    const expected = revealNext.value.responses.filter((item) => item.status === 'success').map((item) => [item.anonymousId, item.model, item.content]);

    const revealedDetail = await fetch(`${base}/api/conversations/${rankingEvent.conversationId}`).then((r) => r.json());
    const revealedRun = revealedDetail.conversation.runs[0];
    assert.ok(revealedRun.revealed_at);
    for (const [anonymousId, model, content] of expected) {
      assert.ok(revealedRun.ranking.some((item) => item.responseId === anonymousId && item.model === model));
      assert.ok(revealedRun.responses.some((item) => item.anonymous_id === anonymousId && item.model === model && item.content === content));
    }

    const revealedExport = await fetch(`${base}/api/runs/${rankingEvent.runId}/export.md`);
    const markdown = await revealedExport.text();
    assert.equal(revealedExport.status, 200);
    for (const [anonymousId, model, content] of expected) {
      assert.ok(markdown.includes(`### ${anonymousId} / ${model}`));
      assert.ok(markdown.includes(content));
    }

    for await (const event of iterator) {
      if (event.type === 'model_status' && event.stage === 'improvement' && event.status === 'running') provider.resolve(event.model, `Verbessert ${event.model}`);
      if (event.type === 'model_status' && event.stage === 're_review' && event.status === 'running') provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
      if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
    }
  } finally {
    server.close();
  }
});

test('after reveal SSE, detail API and markdown export expose the same mapping', async () => {
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-app-${Date.now()}-${Math.random()}.db`)));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const app = createApp({ config: loadRuntimeConfig(), store, provider, orchestrator });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = [];

  try {
    await consumeRun(orchestrator, provider, events);
    const reveal = events.find((event) => event.type === 'answers_revealed');
    assert.ok(reveal);
    const expected = reveal.responses.filter((item) => item.status === 'success').map((item) => [item.anonymousId, item.model, item.content]);

    const detail = await fetch(`${base}/api/conversations/${reveal.conversationId}`).then((r) => r.json());
    const run = detail.conversation.runs[0];
    assert.ok(run.revealed_at);
    for (const [anonymousId, model, content] of expected) {
      assert.ok(run.responses.some((item) => item.anonymous_id === anonymousId && item.model === model && item.content === content));
    }

    const exportResponse = await fetch(`${base}/api/runs/${reveal.runId}/export.md`);
    const markdown = await exportResponse.text();
    assert.equal(exportResponse.status, 200);
    for (const [anonymousId, model, content] of expected) {
      assert.ok(markdown.includes(`### ${anonymousId} / ${model}`));
      assert.ok(markdown.includes(content));
    }
  } finally {
    server.close();
  }
});

test('OpenRouter run request uses provider context without persisting API key', async () => {
  const secret = 'sk-or-secret-123';
  const store = new CouncilStore(createDb(path.join(os.tmpdir(), `llm-council-openrouter-${Date.now()}-${Math.random()}.db`)));
  const review = ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 });
  const provider = new FakeProvider({
    'openrouter/a': ['Antwort A', review, 'Verbessert A', review],
    'openrouter/b': ['Antwort B', review, 'Verbessert B', review],
    'openrouter/chair': ['Finale Antwort']
  });
  const app = createApp({ config: loadRuntimeConfig(), store, provider, catalog: permissiveCatalog() });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(openRouterRunRequest(secret))
    });
    assert.equal(response.status, 200);
    const events = parseSse(await response.text()).map((frame) => frame.data);
    const final = events.find((event) => event.type === 'final');
    assert.ok(final);
    assert.equal(provider.calls.every((call) => call.model.startsWith('openrouter/')), true);
    assert.equal(provider.calls.every((call) => call.provider?.baseUrl === 'https://openrouter.ai/api/v1'), true);
    assert.equal(provider.calls.every((call) => call.provider?.apiKey === secret), true);

    const run = store.getRun(final.runId);
    assert.equal(JSON.stringify(run.config).includes(secret), false);

    const detail = await fetch(`${base}/api/conversations/${final.conversationId}`).then((r) => r.json());
    assert.equal(JSON.stringify(detail).includes(secret), false);
    assert.ok(detail.conversation.runs[0].responses.every((item) => item.provider_label === 'OpenRouter'));

    const config = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.equal(JSON.stringify(config).includes(secret), false);

    const exportResponse = await fetch(`${base}/api/runs/${final.runId}/export.md`);
    const markdown = await exportResponse.text();
    assert.equal(exportResponse.status, 200);
    assert.equal(markdown.includes(secret), false);
    assert.ok(markdown.includes('OpenRouter / openrouter/a'));
  } finally {
    server.close();
  }
});

test('provider test endpoint redacts API keys from provider errors', async () => {
  const secret = 'sk-or-leaked-value';
  const fetchImpl = async () => new Response(JSON.stringify({ error: `bad key ${secret}`, authorization: `Bearer ${secret}` }), { status: 401 });
  const provider = new OpenAICompatibleProvider(loadRuntimeConfig(), fetchImpl);
  const app = createApp({
    dbPath: path.join(os.tmpdir(), `llm-council-provider-error-${Date.now()}-${Math.random()}.db`),
    config: loadRuntimeConfig(),
    provider
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/api/provider/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: { id: 'openrouter', type: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: secret },
        model: 'openrouter/a'
      })
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(body).includes('Bearer sk-or'), false);
  } finally {
    server.close();
  }
});

function validRunRequest() {
  return {
    question: 'Was ist robuste Fehlerbehandlung?',
    councilModels: ['model-a', 'model-b'],
    chairmanModel: 'chairman-model',
    criteria: [
      { id: 'correctness', weight: 1 },
      { id: 'depth', weight: 1 },
      { id: 'usefulness', weight: 1 }
    ]
  };
}

function openRouterRunRequest(apiKey) {
  const provider = { id: 'openrouter', type: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey };
  return {
    question: 'Was ist robuste Fehlerbehandlung?',
    councilModels: [
      { provider, model: 'openrouter/a' },
      { provider, model: 'openrouter/b' }
    ],
    chairmanModel: { provider, model: 'openrouter/chair' },
    criteria: [
      { id: 'correctness', weight: 1 },
      { id: 'depth', weight: 1 },
      { id: 'usefulness', weight: 1 }
    ]
  };
}

function permissiveCatalog() {
  return {
    async validateSelection(ids) {
      return ids.map((id) => ({ requestedId: id, ok: true, canonicalSlug: id, error: null }));
    }
  };
}

function reviewJson(ids) {
  return JSON.stringify({
    responses: ids.map((id, index) => ({
      responseId: id,
      scores: { correctness: 9 - index, depth: 8 - index, usefulness: 7 - index },
      rationale: 'begruendung',
      strengths: ['staerke'],
      weaknesses: ['schwaeche']
    })),
    ranking: ids
  });
}

function parseSse(text) {
  return text.trim().split('\n\n').filter(Boolean).map((frame) => {
    const type = frame.match(/^event: (.+)$/m)?.[1];
    const data = frame.match(/^data: (.+)$/m)?.[1];
    return { type, data: data ? JSON.parse(data) : null };
  });
}

async function postRunAndDisconnect(port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(validRunRequest());
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/runs',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const runId = buffer.match(/"runId":"([^"]+)"/)?.[1];
        if (runId && buffer.includes('model_status')) {
          req.destroy();
          resolve(runId);
        }
      });
    });
    req.on('error', (error) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end(body);
  });
}

async function waitForRunStatus(store, runId, status) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const run = store.getRun(runId);
    if (run?.status === status) return run;
    await delay(20);
  }
  assert.fail(`Run ${runId} did not reach ${status}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DeferredProvider {
  constructor() {
    this.pending = [];
    this.ready = new Map();
  }

  async chat({ model, signal }) {
    if (signal?.aborted) throw signal.reason || new Error('aborted');
    if (this.ready.has(model)) {
      const content = this.ready.get(model).shift();
      if (!this.ready.get(model).length) this.ready.delete(model);
      return { content, usage: { total_tokens: 1 }, latencyMs: 1 };
    }
    return await new Promise((resolve, reject) => {
      const pending = { model, resolve, reject };
      this.pending.push(pending);
      signal?.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
    });
  }

  resolve(model, content) {
    const index = this.pending.findIndex((pending) => pending.model === model);
    if (index === -1) {
      const queued = this.ready.get(model) || [];
      queued.push(content);
      this.ready.set(model, queued);
      return;
    }
    const [item] = this.pending.splice(index, 1);
    item.resolve({ content, usage: { total_tokens: 1 }, latencyMs: 1 });
  }

  reject(model, error) {
    const index = this.pending.findIndex((pending) => pending.model === model);
    if (index === -1) return;
    const [item] = this.pending.splice(index, 1);
    item.reject(error);
  }
}

async function consumeRun(orchestrator, provider, events) {
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) {
    events.push(event);
    if (event.type === 'model_status' && event.stage === 'answers' && event.status === 'running') provider.resolve(event.model, `Antwort ${event.model}`);
    if (event.type === 'model_status' && (event.stage === 'reviews' || event.stage === 're_review') && event.status === 'running') provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
    if (event.type === 'model_status' && event.stage === 'improvement' && event.status === 'running') provider.resolve(event.model, `Verbessert ${event.model}`);
    if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
  }
}

function createPause(onPaused) {
  let release;
  return {
    wait(context) {
      onPaused(context);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    release() {
      release?.();
    }
  };
}
