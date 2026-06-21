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
