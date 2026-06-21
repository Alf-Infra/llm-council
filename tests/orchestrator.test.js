import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { CouncilOrchestrator } from '../server/orchestrator.js';
import { CouncilStore, createDb } from '../server/db.js';

class FakeProvider {
  constructor(map) {
    this.map = map;
    this.calls = [];
  }
  async chat({ model, messages }) {
    this.calls.push({ model, messages });
    const script = this.map[model] || [];
    const next = Array.isArray(script) ? script.shift() : script;
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next({ model, messages });
    return {
      content: next || `answer from ${model}`,
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      latencyMs: 5
    };
  }
}

const criteria = [
  { id: 'correctness', label: 'Korrektheit', weight: 1 },
  { id: 'depth', label: 'Tiefe', weight: 1 },
  { id: 'usefulness', label: 'Praxisnutzen', weight: 1 }
];

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

test('orchestrator tolerates one answer failure and persists run data', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new FakeProvider({
    a: ['Antwort A', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    b: ['Antwort B', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    c: [new Error('timeout'), ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    chair: ['Finale Antwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b', 'c'], chairmanModel: 'chair', criteria }, new AbortController().signal)) {
    events.push(event);
  }
  const final = events.find((event) => event.type === 'final');
  assert.ok(final);
  const runId = final.runId;
  assert.equal(store.getRun(runId).status, 'completed');
  assert.equal(store.getResponses(runId).length, 3);
  assert.equal(store.getResponses(runId).filter((r) => r.status === 'success').length, 2);
  assert.equal(store.getReviews(runId).length, 3);
  assert.equal(store.getRanking(runId).length, 2);
});

test('invalid review JSON is repaired once by the same model', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-repair-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new FakeProvider({
    a: ['Antwort A', 'not json', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 2 }, latencyMs: 3 })],
    b: ['Antwort B', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 2 }, latencyMs: 3 })],
    chair: ['Finale Antwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) events.push(event);
  assert.ok(events.find((event) => event.type === 'final'));
  assert.equal(provider.calls.filter((call) => call.model === 'a').length, 3);
});
