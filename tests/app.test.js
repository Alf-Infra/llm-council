import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadRuntimeConfig } from '../server/config.js';

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
