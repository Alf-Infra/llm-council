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

const criteria = [
  { id: 'correctness', label: 'Korrektheit', weight: 1 },
  { id: 'depth', label: 'Tiefe', weight: 1 },
  { id: 'usefulness', label: 'Praxisnutzen', weight: 1 }
];

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
    orchestrator
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
    orchestrator
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
    if (event.type === 'model_status' && event.stage === 'reviews' && event.status === 'running') provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
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
