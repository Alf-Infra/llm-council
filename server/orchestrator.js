import { anonymizeResponses } from './anonymize.js';
import { aggregateReviews } from './aggregate.js';
import { buildReviewRepairPrompt, extractJsonObject, validateReviewPayload } from './reviewSchema.js';
import { now } from './db.js';

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
      for (const item of anonymous) this.store.setAnonymousId(run.id, item.model, item.anonymousId);
      yield emit('answers_complete', { responses: anonymous.map(stripPreReviewMapping) });

      this.store.updateRun(run.id, { status: 'running', stage: 'reviews' });
      yield emit('stage', { stage: 'reviews' });
      const reviews = yield* this.collectReviews(run.id, input, anonymous, signal, emit);
      const validReviews = reviews.results.filter((item) => item.status === 'success').map((item) => item.review);
      const ranking = aggregateReviews(validReviews, anonymous, input.criteria);
      this.store.saveRanking(run.id, ranking);
      await this.hooks.afterRankingSaved?.({ runId: run.id, conversationId: conversation.id });
      this.store.markRunRevealed(run.id);
      yield emit('ranking', { ranking });
      yield emit('answers_revealed', { responses: answers.results.map((item) => revealResponse(item, anonymous)) });

      this.store.updateRun(run.id, { status: 'running', stage: 'synthesis' });
      yield emit('stage', { stage: 'synthesis' });
      const chairman = await this.runChairman(run.id, input, successes, validReviews, ranking, signal);
      if (chairman.status === 'success') {
        this.store.addMessage(conversation.id, 'assistant', chairman.content);
        const summary = summarizeRun(started, answers.results, reviews.results, chairman);
        this.store.updateRun(run.id, { status: 'completed', stage: 'complete', summary, final_answer: chairman.content, completed_at: now() });
        yield emit('final', { finalAnswer: chairman.content, summary });
      } else {
        this.store.addError(run.id, 'chairman', chairman.error);
        const summary = summarizeRun(started, answers.results, reviews.results, chairman);
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
    const tasks = input.councilModels.map(async (model, index) => {
      queue.push(emit('model_status', { model, stage: 'answers', status: 'running' }));
      try {
        const result = await this.provider.chat({
          model,
          signal,
          messages: buildAnswerMessages(input.question, context)
        });
        const item = { model, status: 'success', content: result.content, latencyMs: result.latencyMs, usage: result.usage };
        this.store.addResponse({ runId, ...item });
        queue.push(emit('model_status', { model, stage: 'answers', status: 'success', response: publicResponseStatus(item) }));
        results[index] = item;
        return item;
      } catch (error) {
        if (signal?.aborted) throw error;
        const item = { model, status: 'failed', error: safeMessage(error) };
        this.store.addResponse({ runId, ...item });
        this.store.addError(runId, `answer:${model}`, item.error);
        queue.push(emit('model_status', { model, stage: 'answers', status: 'failed', error: item.error }));
        results[index] = item;
        return item;
      }
    });
    closeQueueWhenDone(queue, tasks);
    for await (const event of queue) yield event;
    await throwIfRejected(tasks);
    return { results };
  }

  async *collectReviews(runId, input, anonymous, signal, emit) {
    const queue = new AsyncEventQueue();
    const anonymousIds = anonymous.map((item) => item.anonymousId);
    const criteriaIds = input.criteria.map((item) => item.id);
    const results = new Array(input.councilModels.length);
    const tasks = input.councilModels.map(async (model, index) => {
      queue.push(emit('model_status', { model, stage: 'reviews', status: 'running' }));
      const prompt = buildReviewPrompt(input.question, anonymous, input.criteria);
      try {
        const first = await this.provider.chat({ model, signal, responseFormatJson: true, messages: [{ role: 'system', content: reviewSystemPrompt(input.criteria) }, { role: 'user', content: prompt }] });
        const parsed = await this.parseOrRepairReview(model, first.content, first.usage, first.latencyMs, anonymousIds, criteriaIds, input.criteria, signal);
        const item = { reviewerModel: model, status: 'success', review: parsed.review, latencyMs: parsed.latencyMs, usage: mergeUsage(first.usage, parsed.repairUsage) };
        this.store.addReview({ runId, ...item });
        queue.push(emit('model_status', { model, stage: 'reviews', status: 'success', review: item.review }));
        results[index] = item;
        return item;
      } catch (error) {
        if (signal?.aborted) throw error;
        const item = { reviewerModel: model, status: 'failed', error: safeMessage(error) };
        this.store.addReview({ runId, ...item });
        this.store.addError(runId, `review:${model}`, item.error);
        queue.push(emit('model_status', { model, stage: 'reviews', status: 'failed', error: item.error }));
        results[index] = item;
        return item;
      }
    });
    closeQueueWhenDone(queue, tasks);
    for await (const event of queue) yield event;
    await throwIfRejected(tasks);
    return { results };
  }

  async parseOrRepairReview(model, content, usage, latencyMs, anonymousIds, criteriaIds, criteria, signal) {
    try {
      const payload = extractJsonObject(content);
      const valid = validateReviewPayload(payload, anonymousIds, criteriaIds);
      if (!valid.ok) throw new Error(valid.error);
      return { review: valid.value, usage, latencyMs };
    } catch (firstError) {
      const repair = await this.provider.chat({
        model,
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
        model: input.chairmanModel,
        signal,
        messages: [
          { role: 'system', content: 'Du bist Chairman eines LLM-Councils. Schreibe eine eigenständige, transparente finale Antwort. Berücksichtige Konsens, Konflikte und Unsicherheiten.' },
          { role: 'user', content: buildChairmanPrompt(input.question, answers, reviews, ranking) }
        ]
      });
      return { status: 'success', model: input.chairmanModel, content: result.content, latencyMs: result.latencyMs, usage: result.usage };
    } catch (error) {
      return { status: 'failed', model: input.chairmanModel, error: safeMessage(error) };
    }
  }
}

function buildAnswerMessages(question, context) {
  const contextText = context.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  return [
    { role: 'system', content: 'Beantworte die Nutzerfrage sachlich, strukturiert und mit klaren Annahmen. Nutze vorhandenen Dialogkontext nur, wenn relevant.' },
    { role: 'user', content: `${contextText ? `Bisheriger Dialogkontext:\n${contextText}\n\n` : ''}Aktuelle Frage:\n${question}` }
  ];
}

function reviewSystemPrompt(criteria) {
  return `Du bewertest anonymisierte Antworten. Gib ausschließlich valides JSON zurück. Scores sind ganze Zahlen von 1 bis 10 für: ${criteria.map((c) => c.id).join(', ')}.`;
}

function buildReviewPrompt(question, anonymous, criteria) {
  return [
    `Originalfrage:\n${question}`,
    `Kriterien:\n${criteria.map((c) => `${c.id} (${c.label}, Gewicht ${c.weight})`).join(', ')}`,
    'Bewerte jede Antwort ohne Kenntnis der Modelle.',
    ...anonymous.map((item) => `\n${item.anonymousId}:\n${item.content}`),
    'JSON-Schema exakt: {"responses":[{"responseId":"Response A","scores":{"correctness":1,"depth":1,"usefulness":1},"rationale":"kurz","strengths":["..."],"weaknesses":["..."]}],"ranking":["Response A","Response B"]}'
  ].join('\n\n');
}

function buildChairmanPrompt(question, answers, reviews, ranking) {
  return JSON.stringify({ question, answers: answers.map(({ model, content }) => ({ model, content })), reviews, ranking }, null, 2);
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
  return { model: item.model, status: item.status, latencyMs: item.latencyMs, usage: item.usage };
}

function stripPreReviewMapping(item) {
  return { anonymousId: item.anonymousId, content: item.content };
}

function revealResponse(item, anonymous) {
  const mapped = anonymous.find((response) => response.model === item.model);
  return {
    model: item.model,
    anonymousId: mapped?.anonymousId || null,
    status: item.status,
    content: item.content,
    error: item.error,
    latencyMs: item.latencyMs,
    usage: item.usage
  };
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
    councilModels: input.councilModels,
    chairmanModel: input.chairmanModel,
    criteria: input.criteria
  };
}

function safeMessage(error) {
  return String(error?.message || error || 'Unbekannter Fehler').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 500);
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
