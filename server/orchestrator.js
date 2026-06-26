import { anonymizeResponses } from './anonymize.js';
import { aggregateReviews } from './aggregate.js';
import { buildReviewRepairPrompt, extractJsonObject, validateReviewPayload } from './reviewSchema.js';
import { now } from './db.js';
import { safeModelRef } from './validation.js';

export class CouncilOrchestrator {
  constructor({ provider, store, randomSeedFactory = (runId) => runId, hooks = {} }) {
    this.provider = provider;
    this.store = store;
    this.randomSeedFactory = randomSeedFactory;
    this.hooks = hooks;
  }

  async *run(input, signal) {
    const conversation = input.conversationId ? this.store.getConversation(input.conversationId) : this.store.createConversation(input.question);
    if (!conversation) throw new Error('Conversation nicht gefunden.');
    const message = this.store.addMessage(conversation.id, 'user', input.question);
    const run = this.store.createRun({ conversationId: conversation.id, messageId: message.id, config: redactConfig(input) });
    const started = performance.now();
    const emit = (type, payload = {}) => ({ type, runId: run.id, conversationId: conversation.id, ...payload });

    try {
      yield emit('run_started', { run: this.store.getRun(run.id) });
      yield emit('stage', { stage: 'answers' });
      const context = this.store.getContext(conversation.id, 6);
      const answers = yield* this.collectAnswers(run.id, input, context, signal, emit);

      const successes = answers.results.filter((item) => item.status === 'success');
      if (successes.length < 2) {
        const summary = summarizeRun(started, answers.results, [], null);
        this.store.updateRun(run.id, { status: 'failed', stage: 'answers', summary, completed_at: now(), chairman_error: 'Weniger als zwei erfolgreiche Antworten.' });
        yield emit('run_failed', { error: 'Weniger als zwei erfolgreiche Antworten.', summary });
        return;
      }

      const anonymous = anonymizeResponses(successes, this.randomSeedFactory(run.id));
      for (const item of anonymous) this.store.setAnonymousId(run.id, item.modelKey, item.anonymousId);
      yield emit('answers_complete', { responses: anonymous.map(stripPreReviewMapping) });

      this.store.updateRun(run.id, { status: 'running', stage: 'reviews' });
      yield emit('stage', { stage: 'reviews' });
      const reviews = yield* this.collectReviews(run.id, input, anonymous, signal, emit);
      const validReviews = reviews.results.filter((item) => item.status === 'success').map((item) => item.review);
      const ranking = aggregateReviews(validReviews, anonymous, input.criteria);
      this.store.saveRanking(run.id, ranking);
      await this.hooks.afterRankingSaved?.({ runId: run.id, conversationId: conversation.id });
      yield emit('ranking', { ranking: ranking.map(redactRankingModel) });
      this.store.markRunRevealed(run.id);
      yield emit('answers_revealed', { responses: answers.results.map((item) => revealResponse(item, anonymous)) });

      // Improvement round
      this.store.updateRun(run.id, { status: 'running', stage: 'improvement' });
      yield emit('stage', { stage: 'improvement' });
      const improvements = yield* this.collectImprovements(run.id, input, anonymous, validReviews, signal, emit);
      const improvedSuccesses = improvements.results.filter((item) => item.status === 'success');

      let chairmanAnswers = successes;
      let chairmanReviews = validReviews;
      let chairmanRanking = ranking;

      if (improvedSuccesses.length >= 2) {
        const improvedAnonymous = anonymizeResponses(improvedSuccesses, this.randomSeedFactory(run.id + '-r2'));
        for (const item of improvedAnonymous) this.store.setAnonymousId(run.id, item.modelKey, item.anonymousId);
        yield emit('improvements_complete', { responses: improvedAnonymous.map(stripPreReviewMapping) });

        // Re-review
        this.store.updateRun(run.id, { status: 'running', stage: 're_review' });
        yield emit('stage', { stage: 're_review' });
        const reReviews = yield* this.collectReviews(run.id, input, improvedAnonymous, signal, emit, 2);
        const validReReviews = reReviews.results.filter((item) => item.status === 'success').map((item) => item.review);
        const reRanking = aggregateReviews(validReReviews, improvedAnonymous, input.criteria);
        this.store.saveRanking(run.id, reRanking);
        yield emit('re_ranking', { ranking: reRanking.map(redactRankingModel) });
        yield emit('improvements_revealed', { responses: improvements.results.map((item) => revealResponse(item, improvedAnonymous)) });

        chairmanAnswers = improvedSuccesses;
        chairmanReviews = validReReviews;
        chairmanRanking = reRanking;
      } else {
        yield emit('improvements_complete', { responses: [] });
      }

      this.store.updateRun(run.id, { status: 'running', stage: 'synthesis' });
      yield emit('stage', { stage: 'synthesis' });
      const chairman = await this.runChairman(run.id, input, chairmanAnswers, chairmanReviews, chairmanRanking, signal);
      const allResults = [...answers.results, ...reviews.results, ...improvements.results, ...(improvedSuccesses.length >= 2 ? [] : [])];
      if (chairman.status === 'success') {
        this.store.addMessage(conversation.id, 'assistant', chairman.content);
        const summary = summarizeRun(started, allResults, [], chairman);
        this.store.updateRun(run.id, { status: 'completed', stage: 'complete', summary, final_answer: chairman.content, completed_at: now() });
        yield emit('final', { finalAnswer: chairman.content, summary });
      } else {
        this.store.addError(run.id, 'chairman', chairman.error);
        const summary = summarizeRun(started, allResults, [], chairman);
        this.store.updateRun(run.id, { status: 'chairman_failed', stage: 'complete', summary, chairman_error: chairman.error, completed_at: now() });
        yield emit('chairman_failed', { error: chairman.error, summary });
      }
    } catch (error) {
      const aborted = signal?.aborted;
      this.store.addError(run.id, aborted ? 'abort' : 'run', safeMessage(error));
      this.store.updateRun(run.id, { status: aborted ? 'aborted' : 'failed', stage: 'complete', completed_at: now(), chairman_error: safeMessage(error) });
      yield emit(aborted ? 'aborted' : 'run_failed', { error: aborted ? 'Der Lauf wurde abgebrochen.' : safeMessage(error) });
    }
  }

  async *collectAnswers(runId, input, context, signal, emit) {
    const queue = new AsyncEventQueue();
    const results = new Array(input.councilModels.length);
    const tasks = input.councilModels.map(async (modelRef, index) => {
      const model = publicModelName(modelRef);
      queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'answers', status: 'running' }));
      try {
        const result = await this.provider.chat({
          model: rawModelName(modelRef),
          provider: modelRef.provider,
          signal,
          messages: buildAnswerMessages(input.question, context)
        });
        const item = { model, modelKey: modelKey(modelRef), provider: publicProvider(modelRef), status: 'success', content: result.content, latencyMs: result.latencyMs, usage: result.usage };
        this.store.addResponse({ runId, ...item });
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'answers', status: 'success', response: publicResponseStatus(item) }));
        results[index] = item;
        return item;
      } catch (error) {
        if (signal?.aborted) throw error;
        const item = { model, modelKey: modelKey(modelRef), provider: publicProvider(modelRef), status: 'failed', error: safeMessage(error) };
        this.store.addResponse({ runId, ...item });
        this.store.addError(runId, `answer:${model}`, item.error);
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'answers', status: 'failed', error: item.error }));
        results[index] = item;
        return item;
      }
    });
    closeQueueWhenDone(queue, tasks);
    for await (const event of queue) yield event;
    await throwIfRejected(tasks);
    return { results };
  }

  async *collectImprovements(runId, input, anonymous, validReviews, signal, emit) {
    const queue = new AsyncEventQueue();
    const results = new Array(input.councilModels.length);
    const tasks = input.councilModels.map(async (modelRef, index) => {
      const model = publicModelName(modelRef);
      const key = modelKey(modelRef);
      const original = anonymous.find((item) => item.modelKey === key);
      if (!original) { results[index] = { model, status: 'failed', error: 'Originalantwort nicht gefunden.' }; return results[index]; }
      const feedback = gatherFeedbackForModel(original.anonymousId, validReviews);
      queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'improvement', status: 'running' }));
      try {
        const result = await this.provider.chat({
          model: rawModelName(modelRef),
          provider: modelRef.provider,
          signal,
          messages: buildImprovementMessages(input.question, original.content, feedback)
        });
        const item = { model, modelKey: key, provider: publicProvider(modelRef), status: 'success', content: result.content, latencyMs: result.latencyMs, usage: result.usage };
        this.store.addResponse({ runId, ...item, round: 2 });
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'improvement', status: 'success', response: publicResponseStatus(item) }));
        results[index] = item;
        return item;
      } catch (error) {
        if (signal?.aborted) throw error;
        const item = { model, modelKey: key, provider: publicProvider(modelRef), status: 'failed', error: safeMessage(error) };
        this.store.addResponse({ runId, ...item, round: 2 });
        this.store.addError(runId, `improvement:${model}`, item.error);
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: 'improvement', status: 'failed', error: item.error }));
        results[index] = item;
        return item;
      }
    });
    closeQueueWhenDone(queue, tasks);
    for await (const event of queue) yield event;
    await throwIfRejected(tasks);
    return { results };
  }

  async *collectReviews(runId, input, anonymous, signal, emit, round = 1) {
    const queue = new AsyncEventQueue();
    const stageName = round === 1 ? 'reviews' : 're_review';
    const anonymousIds = anonymous.map((item) => item.anonymousId);
    const criteriaIds = input.criteria.map((item) => item.id);
    const results = new Array(input.councilModels.length);
    const tasks = input.councilModels.map(async (modelRef, index) => {
      const model = publicModelName(modelRef);
      queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: stageName, status: 'running' }));
      const prompt = buildReviewPrompt(input.question, anonymous, input.criteria);
      try {
        const first = await this.provider.chat({ model: rawModelName(modelRef), provider: modelRef.provider, signal, responseFormatJson: true, messages: [{ role: 'system', content: reviewSystemPrompt(input.criteria) }, { role: 'user', content: prompt }] });
        const parsed = await this.parseOrRepairReview(modelRef, first.content, first.usage, first.latencyMs, anonymousIds, criteriaIds, input.criteria, signal);
        const item = { reviewerModel: model, reviewerKey: modelKey(modelRef), provider: publicProvider(modelRef), status: 'success', review: parsed.review, latencyMs: parsed.latencyMs, usage: mergeUsage(first.usage, parsed.repairUsage) };
        this.store.addReview({ runId, ...item, round });
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: stageName, status: 'success', review: item.review }));
        results[index] = item;
        return item;
      } catch (error) {
        if (signal?.aborted) throw error;
        const item = { reviewerModel: model, reviewerKey: modelKey(modelRef), provider: publicProvider(modelRef), status: 'failed', error: safeMessage(error) };
        this.store.addReview({ runId, ...item, round });
        this.store.addError(runId, `review:${model}`, item.error);
        queue.push(emit('model_status', { model, provider: publicProvider(modelRef), stage: stageName, status: 'failed', error: item.error }));
        results[index] = item;
        return item;
      }
    });
    closeQueueWhenDone(queue, tasks);
    for await (const event of queue) yield event;
    await throwIfRejected(tasks);
    return { results };
  }

  async parseOrRepairReview(modelRef, content, usage, latencyMs, anonymousIds, criteriaIds, criteria, signal) {
    try {
      const payload = extractJsonObject(content);
      const valid = validateReviewPayload(payload, anonymousIds, criteriaIds);
      if (!valid.ok) throw new Error(valid.error);
      return { review: valid.value, usage, latencyMs };
    } catch (firstError) {
      const repair = await this.provider.chat({
        model: rawModelName(modelRef),
        provider: modelRef.provider,
        signal,
        responseFormatJson: true,
        messages: [{ role: 'system', content: reviewSystemPrompt(criteria) }, { role: 'user', content: buildReviewRepairPrompt(content, firstError.message, anonymousIds, criteria) }]
      });
      const repaired = extractJsonObject(repair.content);
      const valid = validateReviewPayload(repaired, anonymousIds, criteriaIds);
      if (!valid.ok) throw new Error(`JSON-Reparatur fehlgeschlagen: ${valid.error}`);
      return { review: valid.value, repairUsage: repair.usage, latencyMs: latencyMs + repair.latencyMs };
    }
  }

  async runChairman(runId, input, answers, reviews, ranking, signal) {
    try {
      const result = await this.provider.chat({
        model: rawModelName(input.chairmanModel),
        provider: input.chairmanModel.provider,
        signal,
        maxOutputTokens: 16384,
        messages: [
          { role: 'system', content: 'Du bist Chairman eines LLM-Councils. Deine Aufgabe: (1) Identifiziere Konsenspunkte über alle Antworten. (2) Löse Konflikte und Widersprüche mit Begründung. (3) Fülle Lücken, die einzelne Antworten übersehen haben. (4) Schreibe eine finale Antwort mit Quellenattribution (z.B. "Laut Modell X..."). Strukturiere deine Antwort klar mit Überschriften.' },
          { role: 'user', content: buildChairmanPrompt(input.question, answers, reviews, ranking) }
        ]
      });
      return { status: 'success', model: publicModelName(input.chairmanModel), provider: publicProvider(input.chairmanModel), content: result.content, latencyMs: result.latencyMs, usage: result.usage };
    } catch (error) {
      return { status: 'failed', model: publicModelName(input.chairmanModel), provider: publicProvider(input.chairmanModel), error: safeMessage(error) };
    }
  }
}

function gatherFeedbackForModel(anonymousId, validReviews) {
  return validReviews.map((review) => {
    const entry = review.responses?.find((r) => r.responseId === anonymousId);
    if (!entry) return null;
    return { scores: entry.scores, rationale: entry.rationale, strengths: entry.strengths, weaknesses: entry.weaknesses };
  }).filter(Boolean);
}

function buildImprovementMessages(question, originalAnswer, feedback) {
  const feedbackText = feedback.map((f, i) => {
    const scores = Object.entries(f.scores).map(([k, v]) => `${k}: ${v}/10`).join(', ');
    return `Reviewer ${i + 1}: ${scores}\nBegründung: ${f.rationale}\nStärken: ${f.strengths.join('; ')}\nSchwächen: ${f.weaknesses.join('; ')}`;
  }).join('\n\n');
  return [
    { role: 'system', content: 'Du erhältst deine ursprüngliche Antwort und Peer-Feedback. Überarbeite deine Antwort: Behebe die genannten Schwächen, behalte die Stärken. Sei präzise und strukturiert.' },
    { role: 'user', content: `Frage: ${question}\n\nDeine ursprüngliche Antwort:\n${originalAnswer}\n\nPeer-Feedback:\n${feedbackText}\n\nSchreibe jetzt deine verbesserte Antwort.` }
  ];
}

function buildAnswerMessages(question, context) {
  const contextText = context.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  return [
    { role: 'system', content: 'Beantworte die Nutzerfrage sachlich, strukturiert und mit klaren Annahmen. Nutze vorhandenen Dialogkontext nur, wenn relevant.' },
    { role: 'user', content: `${contextText ? `Bisheriger Dialogkontext:\n${contextText}\n\n` : ''}Aktuelle Frage:\n${question}` }
  ];
}

function reviewSystemPrompt(criteria) {
  return `Du bewertest anonymisierte Antworten. Gib ausschließlich valides JSON zurück. Scores sind ganze Zahlen von 1 bis 10 für: ${criteria.map((c) => c.id).join(', ')}. Füge für jede Antwort ein Feld "detailed_analysis" hinzu – eine freie Textanalyse der Qualität (2-4 Sätze).`;
}

function buildReviewPrompt(question, anonymous, criteria) {
  return [
    `Originalfrage:\n${question}`,
    `Kriterien:\n${criteria.map((c) => `${c.id} (${c.label}, Gewicht ${c.weight})`).join(', ')}`,
    'Bewerte jede Antwort ohne Kenntnis der Modelle.',
    ...anonymous.map((item) => `\n${item.anonymousId}:\n${item.content}`),
    'JSON-Schema exakt: {"responses":[{"responseId":"Response A","scores":{"correctness":1,"depth":1,"usefulness":1},"rationale":"kurz","strengths":["..."],"weaknesses":["..."],"detailed_analysis":"Freitextanalyse der Qualität"}],"ranking":["Response A","Response B"]}'
  ].join('\n\n');
}

function buildChairmanPrompt(question, answers, reviews, ranking) {
  const rankingText = ranking.map((r) => `${r.rank}. ${r.model} (Score: ${r.weightedScore})`).join('\n');
  const answersText = answers.map((a) => `### ${a.model}\n${a.content}`).join('\n\n');
  const reviewSummary = summarizeReviewsForChairman(reviews, ranking);
  return [
    `## Originalfrage\n${question}`,
    `## Rangliste\n${rankingText}`,
    `## Modellantworten\n${answersText}`,
    `## Review-Zusammenfassung\n${reviewSummary}`
  ].join('\n\n');
}

function summarizeReviewsForChairman(reviews, ranking) {
  if (!reviews.length) return 'Keine Reviews verfügbar.';
  return ranking.map((item) => {
    const avgText = Object.entries(item.averages || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    const allStrengths = [];
    const allWeaknesses = [];
    const analyses = [];
    for (const review of reviews) {
      const entry = review.responses?.find((r) => r.responseId === item.responseId);
      if (!entry) continue;
      if (entry.strengths) allStrengths.push(...entry.strengths);
      if (entry.weaknesses) allWeaknesses.push(...entry.weaknesses);
      if (entry.detailed_analysis) analyses.push(entry.detailed_analysis);
    }
    const parts = [`**${item.responseId} (${item.model})** — Scores: ${avgText}`];
    if (allStrengths.length) parts.push(`Stärken: ${[...new Set(allStrengths)].join('; ')}`);
    if (allWeaknesses.length) parts.push(`Schwächen: ${[...new Set(allWeaknesses)].join('; ')}`);
    if (analyses.length) parts.push(`Analysen: ${analyses.join(' | ')}`);
    return parts.join('\n');
  }).join('\n\n');
}

function summarizeRun(started, answerResults, reviewResults, chairman) {
  const calls = [...answerResults, ...reviewResults, chairman].filter(Boolean);
  const tokenTotals = calls.reduce((acc, item) => {
    acc.prompt += item.usage?.prompt_tokens || 0;
    acc.completion += item.usage?.completion_tokens || 0;
    acc.total += item.usage?.total_tokens || 0;
    return acc;
  }, { prompt: 0, completion: 0, total: 0 });
  return {
    durationMs: Math.round(performance.now() - started),
    modelCalls: calls.length,
    successfulCalls: calls.filter((item) => item.status === 'success').length,
    failedCalls: calls.filter((item) => item.status === 'failed').length,
    tokenTotals
  };
}

function publicResponseStatus(item) {
  return { model: item.model, provider: item.provider, status: item.status, latencyMs: item.latencyMs, usage: item.usage };
}

function stripPreReviewMapping(item) {
  return { anonymousId: item.anonymousId, content: item.content };
}

function revealResponse(item, anonymous) {
  const mapped = anonymous.find((response) => response.modelKey === item.modelKey);
  return {
    model: item.model,
    provider: item.provider,
    anonymousId: mapped?.anonymousId || null,
    status: item.status,
    content: item.content,
    error: item.error,
    latencyMs: item.latencyMs,
    usage: item.usage
  };
}

function redactRankingModel(item) {
  const { model: _model, provider: _provider, ...safe } = item;
  return safe;
}

function mergeUsage(a, b) {
  if (!a && !b) return null;
  return {
    prompt_tokens: (a?.prompt_tokens || 0) + (b?.prompt_tokens || 0),
    completion_tokens: (a?.completion_tokens || 0) + (b?.completion_tokens || 0),
    total_tokens: (a?.total_tokens || 0) + (b?.total_tokens || 0)
  };
}

function redactConfig(input) {
  return {
    councilModels: input.councilModels.map((item) => (typeof item === 'string' ? item : safeModelRef(item))),
    chairmanModel: typeof input.chairmanModel === 'string' ? input.chairmanModel : safeModelRef(input.chairmanModel),
    criteria: input.criteria
  };
}

function safeMessage(error) {
  return String(error?.message || error || 'Unbekannter Fehler').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 500);
}

function publicModelName(modelRef) {
  return typeof modelRef === 'string' ? modelRef : modelRef.model;
}

function rawModelName(modelRef) {
  return typeof modelRef === 'string' ? modelRef : modelRef.model;
}

function modelKey(modelRef) {
  return typeof modelRef === 'string' ? modelRef : modelRef.key;
}

function publicProvider(modelRef) {
  if (typeof modelRef === 'string') return null;
  return {
    id: modelRef.provider.id,
    type: modelRef.provider.type,
    label: modelRef.provider.label,
    baseUrl: modelRef.provider.baseUrl
  };
}

class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()({ done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

function closeQueueWhenDone(queue, tasks) {
  Promise.allSettled(tasks).then(() => queue.close());
}

async function throwIfRejected(tasks) {
  const settled = await Promise.allSettled(tasks);
  const rejected = settled.find((item) => item.status === 'rejected');
  if (rejected) throw rejected.reason;
}
