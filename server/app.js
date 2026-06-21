import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouncilStore, createDb } from './db.js';
import { loadRuntimeConfig, safeUiConfig } from './config.js';
import { OpenAICompatibleProvider } from './provider.js';
import { CouncilOrchestrator } from './orchestrator.js';
import { normalizeRunRequest } from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApp(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const store = options.store || new CouncilStore(options.db || createDb(options.dbPath));
  const provider = options.provider || new OpenAICompatibleProvider(config);
  const orchestrator = options.orchestrator || new CouncilOrchestrator({ provider, store });
  const controllers = new Map();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json(safeUiConfig(config)));
  app.get('/api/conversations', (_req, res) => res.json({ conversations: store.listConversations() }));
  app.get('/api/conversations/:id', (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation nicht gefunden.' });
    return res.json({ conversation });
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
    req.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('Client aborted'));
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
      res.end();
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

function writeSse(res, event) {
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
    ...(ranking || []).map((item) => `${item.rank}. ${item.responseId} (${item.model}) - ${item.weightedScore}`),
    '',
    '## Modellantworten',
    ...responses.map((item) => `### ${item.anonymous_id || '-'} / ${item.model}\nStatus: ${item.status}, Laufzeit: ${item.latency_ms ?? '-'} ms, Tokens: ${item.total_tokens ?? '-'}\n\n${item.content || item.error || ''}`),
    '',
    '## Reviews',
    ...reviews.map((item) => `### ${item.reviewer_model}\nStatus: ${item.status}\n\n\`\`\`json\n${JSON.stringify(item.review || { error: item.error }, null, 2)}\n\`\`\``),
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

function safePublicError(error) {
  return String(error?.message || error || 'Unbekannter Fehler').slice(0, 500);
}
