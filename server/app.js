import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouncilStore, createDb } from './db.js';
import { loadRuntimeConfig, safeUiConfig } from './config.js';
import { OpenAICompatibleProvider } from './provider.js';
import { CouncilOrchestrator } from './orchestrator.js';
import { normalizeModelRef, normalizeRunRequest } from './validation.js';
import { OpenRouterCatalog, validatePresets } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApp(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const store = options.store || new CouncilStore(options.db || createDb(options.dbPath));
  const provider = options.provider || new OpenAICompatibleProvider(config);
  const orchestrator = options.orchestrator || new CouncilOrchestrator({ provider, store });
  const catalog = options.catalog || new OpenRouterCatalog(options.catalogOptions);
  const controllers = new Map();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json(safeUiConfig(config)));
  app.get('/api/models', async (req, res) => {
    try {
      const result = await catalog.getModels({ refresh: req.query.refresh === '1' });
      return res.json({ ...result, presets: validatePresets(result.models) });
    } catch (error) {
      return res.status(502).json({ error: 'OpenRouter-Modellkatalog ist derzeit nicht verfügbar.' });
    }
  });
  app.post('/api/models/validate', async (req, res) => {
    const ids = Array.isArray(req.body?.models) ? [...new Set(req.body.models.map(String))].slice(0, 20) : [];
    if (!ids.length) return res.status(400).json({ error: 'Bitte Modelle zur Validierung angeben.' });
    try {
      const results = await catalog.validateSelection(ids);
      return res.json({ ok: results.every((item) => item.ok), results });
    } catch (_error) {
      return res.status(502).json({ error: 'Modellvalidierung ist derzeit nicht verfügbar.' });
    }
  });
  app.post('/api/provider/test', async (req, res) => {
    const modelRef = normalizeModelRef(req.body, config);
    if (!modelRef) return res.status(400).json({ ok: false, error: 'Bitte Provider und Modell angeben.' });
    try {
      const result = await provider.chat({
        model: modelRef.model,
        provider: modelRef.provider,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 15000))
      });
      return res.json({ ok: true, model: modelRef.model, provider: publicProviderFromRow(modelRef.provider), latencyMs: result.latencyMs, usage: result.usage || null });
    } catch (error) {
      return res.status(502).json({ ok: false, error: safePublicError(error, modelRef.provider.apiKey) });
    }
  });
  app.get('/api/conversations', (_req, res) => res.json({ conversations: store.listConversations() }));
  app.get('/api/conversations/:id', (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation nicht gefunden.' });
    return res.json({ conversation: projectConversationForBrowser(conversation) });
  });
  app.delete('/api/conversations/:id', (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation nicht gefunden.' });
    store.deleteConversation(req.params.id);
    return res.json({ ok: true });
  });

  app.post('/api/runs', async (req, res) => {
    const normalized = normalizeRunRequest(req.body, config);
    if (!normalized.ok) return res.status(400).json({ errors: normalized.errors });

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    let runId = null;
    let responseFinished = false;
    res.on('close', () => {
      if (!responseFinished && !controller.signal.aborted) controller.abort(new Error('Client aborted'));
      if (runId) controllers.delete(runId);
    });

    try {
      for await (const event of orchestrator.run(normalized.value, controller.signal)) {
        runId = event.runId || runId;
        if (runId) controllers.set(runId, controller);
        writeSse(res, event);
      }
    } catch (error) {
      writeSse(res, { type: 'run_failed', error: safePublicError(error) });
    } finally {
      if (runId) controllers.delete(runId);
      responseFinished = true;
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  });

  app.post('/api/runs/:id/cancel', (req, res) => {
    const controller = controllers.get(req.params.id);
    if (controller) {
      controller.abort(new Error('User cancelled'));
      return res.json({ ok: true });
    }
    const run = store.getRun(req.params.id);
    if (run && run.status === 'running') store.updateRun(req.params.id, { status: 'aborted', stage: 'complete', completed_at: new Date().toISOString() });
    return res.json({ ok: true });
  });

  app.get('/api/runs/:id/export.md', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).send('Run nicht gefunden.');
    if (!run.revealed_at) return res.status(409).send('Export ist erst nach abgeschlossenem Peer-Review und Reveal verfuegbar.');
    const conversation = store.getConversation(run.conversation_id);
    const responses = store.getResponses(run.id);
    const reviews = store.getReviews(run.id);
    const ranking = store.getRanking(run.id);
    const question = conversation?.messages.find((m) => m.id === run.message_id)?.content || '';
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="llm-council-${run.id}.md"`);
    res.send(renderExport({ run, question, responses, reviews, ranking }));
  });

  const clientDir = path.join(rootDir, 'dist', 'client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  return app;
}

export function projectConversationForBrowser(conversation) {
  return {
    ...conversation,
    runs: (conversation.runs || []).map(projectRunForBrowser)
  };
}

function projectRunForBrowser(run) {
  const reveal = Boolean(run.revealed_at);
  if (reveal) return run;
  const responses = run.responses || [];
  return {
    ...run,
    ranking: Array.isArray(run.ranking) ? run.ranking.map(redactRankingModel) : run.ranking,
    modelStatuses: responses.map((item) => ({
      model: item.model,
      provider: publicProviderFromRow(item),
      status: item.status,
      error: item.status === 'failed' ? item.error : undefined,
      latency_ms: item.latency_ms,
      prompt_tokens: item.prompt_tokens,
      completion_tokens: item.completion_tokens,
      total_tokens: item.total_tokens
    })),
    responses: responses
      .map((item) => {
        if (item.status === 'success' && item.anonymous_id) {
          return { anonymous_id: item.anonymous_id, status: 'success', content: item.content };
        }
        return {
          model: item.model,
          provider: publicProviderFromRow(item),
          status: item.status,
          error: item.error,
          latency_ms: item.latency_ms,
          prompt_tokens: item.prompt_tokens,
          completion_tokens: item.completion_tokens,
          total_tokens: item.total_tokens
        };
      })
      .filter((item) => item.status !== 'success' || item.content || item.model)
  };
}

function redactRankingModel(item) {
  const { model: _model, provider: _provider, ...safe } = item;
  return safe;
}

function writeSse(res, event) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function renderExport({ run, question, responses, reviews, ranking }) {
  return [
    '# LLM Council Export',
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    `Started: ${run.started_at}`,
    '',
    '## Frage',
    question,
    '',
    '## Rangliste',
    ...(ranking || []).map((item) => `${item.rank}. ${item.responseId} (${providerModelLabel(item)}) - ${item.weightedScore}`),
    '',
    '## Modellantworten',
    ...responses.map((item) => `### ${item.anonymous_id || '-'} / ${providerModelLabel(item)}\nStatus: ${item.status}, Laufzeit: ${item.latency_ms ?? '-'} ms, Tokens: ${item.total_tokens ?? '-'}\n\n${item.content || item.error || ''}`),
    '',
    '## Reviews',
    ...reviews.map((item) => `### ${providerReviewerLabel(item)}\nStatus: ${item.status}\n\n\`\`\`json\n${JSON.stringify(item.review || { error: item.error }, null, 2)}\n\`\`\``),
    '',
    '## Finale Antwort',
    run.final_answer || run.chairman_error || '',
    '',
    '## Metadaten',
    '```json',
    JSON.stringify(run.summary || {}, null, 2),
    '```'
  ].join('\n\n');
}

function publicProviderFromRow(row) {
  const id = row?.provider_id || row?.id;
  const type = row?.provider_type || row?.type;
  const label = row?.provider_label || row?.label;
  const baseUrl = row?.provider_base_url || row?.baseUrl;
  return id || type || label || baseUrl ? { id, type, label, baseUrl } : null;
}

function providerModelLabel(item) {
  const provider = item.provider || publicProviderFromRow(item);
  return provider?.label ? `${provider.label} / ${item.model}` : item.model;
}

function providerReviewerLabel(item) {
  const provider = item.provider || publicProviderFromRow(item);
  return provider?.label ? `${provider.label} / ${item.reviewer_model}` : item.reviewer_model;
}

function safePublicError(error, apiKey = '') {
  let message = String(error?.message || error || 'Unbekannter Fehler');
  if (apiKey) message = message.split(apiKey).join('[redacted]');
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 500);
}
