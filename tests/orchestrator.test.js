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

test('answer progress events stream before answer promises settle', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-stream-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const iterator = orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal);

  assert.equal((await iterator.next()).value.type, 'run_started');
  assert.equal((await iterator.next()).value.type, 'stage');
  const firstStatus = (await iterator.next()).value;
  const secondStatus = (await iterator.next()).value;
  assert.deepEqual([firstStatus.status, secondStatus.status], ['running', 'running']);
  assert.deepEqual(new Set([firstStatus.model, secondStatus.model]), new Set(['a', 'b']));

  provider.resolve('a', 'Antwort A');
  provider.resolve('b', 'Antwort B');
  const rest = [];
  for await (const event of iterator) {
    rest.push(event);
    if (event.type === 'model_status' && event.stage === 'reviews') {
      provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
    }
    if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
  }
  assert.ok(rest.find((event) => event.type === 'answers_complete'));
});

test('aborted runs are persisted as aborted', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-abort-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new DeferredProvider();
  const controller = new AbortController();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const iterator = orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, controller.signal);

  const started = (await iterator.next()).value;
  await iterator.next();
  await iterator.next();
  controller.abort(new Error('User cancelled'));

  const events = [];
  for await (const event of iterator) events.push(event);
  assert.equal(events.at(-1).type, 'aborted');
  assert.equal(store.getRun(started.runId).status, 'aborted');
});

test('chairman failure keeps ranking and visible failure status', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-chair-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new FakeProvider({
    a: ['Antwort A', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    b: ['Antwort B', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    chair: [new Error('chair unavailable')]
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) events.push(event);
  const failure = events.find((event) => event.type === 'chairman_failed');
  assert.ok(failure);
  assert.equal(store.getRun(failure.runId).status, 'chairman_failed');
  assert.equal(store.getRanking(failure.runId).length, 2);
});

test('completed runs can be reopened from the same sqlite file after restart', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-reopen-${Date.now()}-${Math.random()}.db`);
  const firstStore = new CouncilStore(createDb(dbPath));
  const provider = new FakeProvider({
    a: ['Antwort A', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    b: ['Antwort B', ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 })],
    chair: ['Finale Antwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store: firstStore, randomSeedFactory: () => 'fixed' });
  let final;
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) {
    if (event.type === 'final') final = event;
  }

  const secondStore = new CouncilStore(createDb(dbPath));
  const conversation = secondStore.getConversation(final.conversationId);
  assert.equal(conversation.runs[0].status, 'completed');
  assert.equal(conversation.runs[0].responses.length, 2);
  assert.equal(conversation.runs[0].ranking.length, 2);
  assert.equal(conversation.runs[0].final_answer, 'Finale Antwort');
});
