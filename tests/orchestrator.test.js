import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { CouncilOrchestrator } from '../server/orchestrator.js';
import { CouncilStore, createDb } from '../server/db.js';
import { projectConversationForBrowser } from '../server/app.js';

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
  const review = ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 });
  const provider = new FakeProvider({
    a: ['Antwort A', review, 'Verbessert A', review],
    b: ['Antwort B', review, 'Verbessert B', review],
    c: [new Error('timeout'), review, new Error('timeout'), review],
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
  const allResponses = store.getResponses(runId);
  assert.equal(allResponses.filter((r) => (r.round || 1) === 1).length, 3);
  assert.equal(allResponses.filter((r) => (r.round || 1) === 1 && r.status === 'success').length, 2);
  assert.ok(store.getReviews(runId).length >= 3);
  assert.equal(store.getRanking(runId).length, 2);
});

test('invalid review JSON is repaired once by the same model', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-repair-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const review = ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 2 }, latencyMs: 3 });
  const provider = new FakeProvider({
    a: ['Antwort A', 'not json', review, 'Verbessert A', review],
    b: ['Antwort B', review, 'Verbessert B', review],
    chair: ['Finale Antwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) events.push(event);
  assert.ok(events.find((event) => event.type === 'final'));
  assert.equal(provider.calls.filter((call) => call.model === 'a').length, 5);
});

test('standard mode executes three phases while legacy missing mode remains iterative', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-standard-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const review = () => ({ content: reviewJson(['Response A', 'Response B']), usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, latencyMs: 2 });
  const provider = new FakeProvider({ a: ['A', review], b: ['B', review], chair: ['Final'] });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];
  const priceSnapshot = { a: { prompt: 0.001, completion: 0.002, request: 0 }, b: { prompt: 0.001, completion: 0.002, request: 0 }, chair: { prompt: 0.001, completion: 0.002, request: 0 } };
  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria, mode: 'standard', priceSnapshot }, new AbortController().signal)) events.push(event);
  assert.deepEqual(events.filter((event) => event.type === 'stage').map((event) => event.stage), ['answers', 'reviews', 'synthesis']);
  assert.equal(provider.calls.length, 5);
  const final = events.find((event) => event.type === 'final');
  assert.ok(final.summary.costEstimate.totalUsd > 0);
  assert.equal(store.getRun(final.runId).config.mode, 'standard');
  assert.deepEqual(store.getResponses(final.runId).map((item) => item.round), [1, 1]);
});

test('chairman receives a direct, anonymous end-answer task with the standard final round', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-chair-prompt-standard-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const ids = ['Response A', 'Response B'];
  const structuredReview = JSON.stringify({
    responses: ids.map((responseId, index) => ({
      responseId,
      scores: { correctness: 9 - index, depth: 8 - index, usefulness: 7 - index },
      rationale: `Begründung ${index + 1}`,
      strengths: [`Stärke ${index + 1}`],
      weaknesses: [`Schwäche ${index + 1}`],
      detailed_analysis: `Detailanalyse ${index + 1}`
    })),
    ranking: ids
  });
  const provider = new FakeProvider({
    'vendor/alpha-model': ['Ursprünglicher Inhalt Alpha', structuredReview],
    'vendor/beta-model': ['Ursprünglicher Inhalt Beta', structuredReview],
    'vendor/chair-model': ['Direkte Endantwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  for await (const unused of orchestrator.run({
    question: 'Welche Lösung ist am besten?',
    councilModels: ['vendor/alpha-model', 'vendor/beta-model'],
    chairmanModel: 'vendor/chair-model',
    criteria,
    mode: 'standard'
  }, new AbortController().signal)) void unused;

  const chairmanCall = provider.calls.find((call) => call.model === 'vendor/chair-model');
  assert.ok(chairmanCall);
  const [system, user] = chairmanCall.messages.map((message) => message.content);
  assert.match(system, /ursprüngliche Nutzerfrage direkt/);
  assert.match(system, /eigenständige Endantwort/);
  assert.doesNotMatch(system, /Laut Modell X|Quellenattribution|Identifiziere Konsenspunkte/);
  assert.match(user, /ORIGINALFRAGE/);
  assert.match(user, /INTERNES ARBEITSMATERIAL/);
  assert.match(user, /ZU ERSTELLENDE ENDANTWORT/);
  assert.match(user, /Kandidat A/);
  assert.match(user, /Kandidat B/);
  assert.match(user, /Ursprünglicher Inhalt Alpha/);
  assert.match(user, /Ursprünglicher Inhalt Beta/);
  assert.match(user, /Begründung 1/);
  assert.match(user, /Stärke 2/);
  assert.match(user, /Schwäche 1/);
  assert.match(user, /Detailanalyse 2/);
  assert.match(user, /Kandidat [AB] → Kandidat [AB]/);
  assert.match(user, /ausschließlich interner Qualitätskontext/);
  assert.doesNotMatch(user, /gewichteter Score|gültige Stimmen|aggregierte Kriterien|correctness|depth|usefulness|\b[12]\. Kandidat/);
  assert.doesNotMatch(user, /vendor\/alpha-model|vendor\/beta-model|Response [AB]/);
});

test('iterative chairman material uses only improved answers, re-reviews and final ranking', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-chair-prompt-iterative-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const firstReview = reviewJson(['Response A', 'Response B']);
  const finalReview = JSON.stringify({
    responses: ['Response A', 'Response B'].map((responseId, index) => ({
      responseId,
      scores: { correctness: 10 - index, depth: 9 - index, usefulness: 8 - index },
      rationale: `Finalbegründung ${index + 1}`,
      strengths: ['Finalstärke'],
      weaknesses: ['Finalschwäche'],
      detailed_analysis: `Finalanalyse ${index + 1}`
    })),
    ranking: ['Response B', 'Response A']
  });
  const provider = new FakeProvider({
    'vendor/alpha-model': ['ALTE ANTWORT ALPHA', firstReview, 'VERBESSERTE ANTWORT ALPHA', finalReview],
    'vendor/beta-model': ['ALTE ANTWORT BETA', firstReview, 'VERBESSERTE ANTWORT BETA', finalReview],
    'vendor/chair-model': ['Direkte Endantwort']
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: (runId) => runId.endsWith('-r2') ? 'round-two' : 'round-one' });
  for await (const unused of orchestrator.run({
    question: 'Gib eine Empfehlung.',
    councilModels: ['vendor/alpha-model', 'vendor/beta-model'],
    chairmanModel: 'vendor/chair-model',
    criteria,
    mode: 'iterative'
  }, new AbortController().signal)) void unused;

  const chairmanCall = provider.calls.find((call) => call.model === 'vendor/chair-model');
  const prompt = chairmanCall.messages[1].content;
  assert.match(prompt, /VERBESSERTE ANTWORT ALPHA/);
  assert.match(prompt, /VERBESSERTE ANTWORT BETA/);
  assert.match(prompt, /Finalbegründung/);
  assert.match(prompt, /Finalanalyse/);
  assert.match(prompt, /Kandidat [AB] → Kandidat [AB]/);
  assert.doesNotMatch(prompt, /ALTE ANTWORT|begruendung|vendor\/alpha-model|vendor\/beta-model|Response [AB]|gewichteter Score|gültige Stimmen|aggregierte Kriterien|correctness|depth|usefulness|\b[12]\. Kandidat/);
});

const forbiddenChairmanMeta = /\b(?:Council|Kandidat(?:en)?|Modell(?:e|en)?|Provider|Ranking|Rangliste|Scores?|Reviews?|Vergleich(?:sbericht|en|e)?)\b/i;

async function runOfflineChairmanScenario({ question, answers, finalAnswer }) {
  const dbPath = path.join(os.tmpdir(), `llm-council-chair-scenario-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const review = reviewJson(['Response A', 'Response B']);
  const provider = new FakeProvider({
    'local/answer-one': [answers[0], review],
    'local/answer-two': [answers[1], review],
    'local/chairman': [finalAnswer]
  });
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'offline-scenario' });
  const events = [];

  for await (const event of orchestrator.run({
    question,
    councilModels: ['local/answer-one', 'local/answer-two'],
    chairmanModel: 'local/chairman',
    criteria,
    mode: 'standard'
  }, new AbortController().signal)) events.push(event);

  const chairmanCall = provider.calls.find((call) => call.model === 'local/chairman');
  const finalEvent = events.find((event) => event.type === 'final');
  assert.ok(chairmanCall, 'der reale Orchestrator muss den Chairman-Provider aufrufen');
  assert.ok(finalEvent, 'der Orchestrator muss die Chairman-Antwort als finales Event liefern');
  assert.equal(finalEvent.finalAnswer, finalAnswer);
  assert.equal(store.getRun(finalEvent.runId).final_answer, finalAnswer);
  assert.doesNotMatch(finalAnswer, forbiddenChairmanMeta);
  return finalAnswer;
}

test('offline chairman scenario answers a knowledge question directly', async () => {
  const question = 'Was ist die Hauptstadt von Australien?';
  const answer = await runOfflineChairmanScenario({
    question,
    answers: [
      'Canberra ist die Hauptstadt Australiens.',
      'Australiens Hauptstadt ist Canberra, nicht Sydney oder Melbourne.'
    ],
    finalAnswer: 'Die Hauptstadt von Australien ist Canberra.'
  });

  assert.match(answer, /^Die Hauptstadt von Australien ist Canberra\.$/);
});

test('offline chairman scenario gives a clear and reasoned recommendation', async () => {
  const question = 'Soll ich für tägliche kurze Stadtwege das Fahrrad oder das Auto nehmen?';
  const answer = await runOfflineChairmanScenario({
    question,
    answers: [
      'Für kurze Stadtwege ist das Fahrrad meist schneller, günstiger und bewegungsfördernd.',
      'Das Fahrrad vermeidet Parkplatzsuche; das Auto ist vor allem bei schwerer Last sinnvoll.'
    ],
    finalAnswer: 'Nimm für deine täglichen kurzen Stadtwege das Fahrrad: Es ist meist günstiger, erleichtert die Parkplatzsuche und bringt regelmäßige Bewegung. Nutze das Auto nur, wenn du schwere Lasten transportierst oder die Bedingungen das Radfahren unsicher machen.'
  });

  assert.match(answer, /Nimm[^.]*Fahrrad/i);
  assert.match(answer, /günstiger|Parkplatzsuche|Bewegung/i);
});

test('offline chairman scenario expresses issue-specific uncertainty on a controversial question', async () => {
  const question = 'Sollte eine Stadt private Autos vollständig aus dem Zentrum verbannen?';
  const answer = await runOfflineChairmanScenario({
    question,
    answers: [
      'Ein Verbot senkt Lärm und Emissionen, braucht aber Ausnahmen für Menschen mit Behinderung und Lieferverkehr.',
      'Die Wirkung hängt von gutem Nahverkehr, sicheren Radwegen und praktikablen Übergangsregeln ab.'
    ],
    finalAnswer: 'Ein vollständiges Verbot ist nicht pauschal sinnvoll. Ob es der Stadt nützt, hängt vor allem von verlässlichem Nahverkehr und sicheren Alternativen ab. Sinnvoller ist häufig eine schrittweise autofreie Zone mit klaren Ausnahmen für Menschen mit Behinderung, Rettungsdienste und notwendigen Lieferverkehr sowie einer überprüfbaren Übergangsphase.'
  });

  assert.match(answer, /nicht pauschal|hängt[^.]*ab/i);
  assert.match(answer, /Ausnahmen|Übergangsphase/i);
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
    if (event.type === 'model_status' && (event.stage === 'reviews' || event.stage === 're_review') && event.status === 'running') {
      provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
    }
    if (event.type === 'model_status' && event.stage === 'improvement' && event.status === 'running') {
      provider.resolve(event.model, `Verbessert ${event.model}`);
    }
    if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
  }
  assert.ok(rest.find((event) => event.type === 'answers_complete'));
});

test('pre-review SSE events and active API projection do not reveal answer-to-model mapping', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-privacy-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const iterator = orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal);

  const events = [];
  while (!events.some((event) => event.type === 'answers_complete')) {
    const next = await iterator.next();
    assert.equal(next.done, false);
    events.push(next.value);
    if (next.value.type === 'model_status' && next.value.stage === 'answers' && next.value.status === 'running') {
      provider.resolve(next.value.model, `Antwort ${next.value.model}`);
    }
  }

  for (const event of events) {
    assert.equal(event.type === 'model_status' && event.stage === 'answers' && Boolean(event.response?.content), false);
    assert.equal(containsModelContentAndAnonymousId(event), false);
  }
  const anonymousPayload = events.find((event) => event.type === 'answers_complete').responses;
  assert.equal(anonymousPayload.length, 2);
  assert.ok(anonymousPayload.every((item) => item.anonymousId && item.content));
  assert.ok(anonymousPayload.every((item) => !item.model && !item.latencyMs && !item.usage));

  const projected = projectConversationForBrowser(store.getConversation(events[0].conversationId));
  const activeRun = projected.runs[0];
  assert.ok(activeRun.modelStatuses.every((item) => item.model && !item.content && !item.anonymous_id));
  assert.equal(activeRun.responses.some((item) => item.model && item.content && item.anonymous_id), false);
  assert.ok(activeRun.responses.filter((item) => item.content).every((item) => item.anonymous_id && !item.model));

  for await (const event of iterator) {
    if (event.type === 'model_status' && (event.stage === 'reviews' || event.stage === 're_review') && event.status === 'running') {
      provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
    }
    if (event.type === 'model_status' && event.stage === 'improvement' && event.status === 'running') {
      provider.resolve(event.model, `Verbessert ${event.model}`);
    }
    if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
  }
});

test('answers are fully revealed after peer review completes', async () => {
  const dbPath = path.join(os.tmpdir(), `llm-council-reveal-${Date.now()}-${Math.random()}.db`);
  const store = new CouncilStore(createDb(dbPath));
  const provider = new DeferredProvider();
  const orchestrator = new CouncilOrchestrator({ provider, store, randomSeedFactory: () => 'fixed' });
  const events = [];

  for await (const event of orchestrator.run({ question: 'Q?', councilModels: ['a', 'b'], chairmanModel: 'chair', criteria }, new AbortController().signal)) {
    events.push(event);
    if (event.type === 'model_status' && event.stage === 'answers' && event.status === 'running') {
      provider.resolve(event.model, `Antwort ${event.model}`);
    }
    if (event.type === 'model_status' && (event.stage === 'reviews' || event.stage === 're_review') && event.status === 'running') {
      provider.resolve(event.model, reviewJson(['Response A', 'Response B']));
    }
    if (event.type === 'model_status' && event.stage === 'improvement' && event.status === 'running') {
      provider.resolve(event.model, `Verbessert ${event.model}`);
    }
    if (event.type === 'stage' && event.stage === 'synthesis') provider.resolve('chair', 'Finale Antwort');
  }

  const reveal = events.find((event) => event.type === 'answers_revealed');
  assert.ok(reveal);
  assert.deepEqual(new Set(reveal.responses.map((item) => item.model)), new Set(['a', 'b']));
  assert.deepEqual(new Set(reveal.responses.map((item) => item.anonymousId)), new Set(['Response A', 'Response B']));
  assert.ok(reveal.responses.every((item) => item.content && item.latencyMs != null && item.usage));

  const projected = projectConversationForBrowser(store.getConversation(events[0].conversationId));
  const completedRun = projected.runs[0];
  assert.ok(completedRun.ranking);
  assert.ok(completedRun.responses.every((item) => item.model && item.anonymous_id && item.content));
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
  const review = ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 });
  const provider = new FakeProvider({
    a: ['Antwort A', review, 'Verbessert A', review],
    b: ['Antwort B', review, 'Verbessert B', review],
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
  const review = ({ messages }) => ({ content: reviewJson(['Response A', 'Response B']), usage: { total_tokens: 3 }, latencyMs: 4 });
  const provider = new FakeProvider({
    a: ['Antwort A', review, 'Verbessert A', review],
    b: ['Antwort B', review, 'Verbessert B', review],
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
  assert.ok(conversation.runs[0].responses.length >= 2);
  assert.equal(conversation.runs[0].ranking.length, 2);
  assert.equal(conversation.runs[0].final_answer, 'Finale Antwort');
});

function containsModelContentAndAnonymousId(value) {
  if (!value || typeof value !== 'object') return false;
  if ('model' in value && 'content' in value && ('anonymousId' in value || 'anonymous_id' in value)) return true;
  return Object.values(value).some((item) => Array.isArray(item)
    ? item.some(containsModelContentAndAnonymousId)
    : containsModelContentAndAnonymousId(item));
}
