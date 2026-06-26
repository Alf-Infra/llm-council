import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function createDb(dbPath = path.join(process.cwd(), 'data', 'llm-council.db')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      config_json TEXT NOT NULL,
      summary_json TEXT,
      final_answer TEXT,
      chairman_error TEXT,
      revealed_at TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_responses (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      model_key TEXT,
      model TEXT NOT NULL,
      provider_id TEXT,
      provider_type TEXT,
      provider_label TEXT,
      provider_base_url TEXT,
      anonymous_id TEXT,
      status TEXT NOT NULL,
      content TEXT,
      error TEXT,
      latency_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      reviewer_key TEXT,
      reviewer_model TEXT NOT NULL,
      provider_id TEXT,
      provider_type TEXT,
      provider_label TEXT,
      provider_base_url TEXT,
      status TEXT NOT NULL,
      review_json TEXT,
      error TEXT,
      latency_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rankings (
      run_id TEXT PRIMARY KEY,
      ranking_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  migrate(db);
  return db;
}

export function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export class CouncilStore {
  constructor(db) {
    this.db = db;
  }

  createConversation(title) {
    const created = now();
    const conversation = { id: id('con'), title: title.slice(0, 80) || 'Neue Conversation', created_at: created, updated_at: created };
    this.db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?)').run(conversation.id, conversation.title, created, created);
    return conversation;
  }

  addMessage(conversationId, role, content) {
    const created = now();
    const message = { id: id('msg'), conversation_id: conversationId, role, content, created_at: created };
    this.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(message.id, conversationId, role, content, created);
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(created, conversationId);
    return message;
  }

  createRun({ conversationId, messageId, config }) {
    const created = now();
    const run = { id: id('run'), conversation_id: conversationId, message_id: messageId, status: 'running', stage: 'answers', started_at: created };
    this.db.prepare('INSERT INTO runs (id, conversation_id, message_id, status, stage, config_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(run.id, conversationId, messageId, 'running', 'answers', JSON.stringify(config), created, created);
    return run;
  }

  updateRun(idValue, patch) {
    const current = this.getRun(idValue);
    if (!current) return null;
    const merged = { ...current, ...patch, updated_at: now() };
    this.db.prepare(`UPDATE runs SET status = ?, stage = ?, summary_json = ?, final_answer = ?, chairman_error = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
      .run(merged.status, merged.stage, stringifyOrNull(merged.summary), merged.final_answer ?? null, merged.chairman_error ?? null, merged.completed_at ?? null, merged.updated_at, idValue);
    return this.getRun(idValue);
  }

  markRunRevealed(runId) {
    const revealedAt = now();
    this.db.prepare('UPDATE runs SET revealed_at = ?, updated_at = ? WHERE id = ?').run(revealedAt, revealedAt, runId);
    return this.getRun(runId);
  }

  addResponse(response) {
    const created = now();
    const provider = response.provider || {};
    this.db.prepare(`INSERT INTO model_responses (id, run_id, model_key, model, provider_id, provider_type, provider_label, provider_base_url, anonymous_id, status, content, error, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('res'), response.runId, response.modelKey ?? response.model, response.model, provider.id ?? null, provider.type ?? null, provider.label ?? null, provider.baseUrl ?? null,
        response.anonymousId ?? null, response.status, response.content ?? null, response.error ?? null,
        response.latencyMs ?? null, response.usage?.prompt_tokens ?? null, response.usage?.completion_tokens ?? null, response.usage?.total_tokens ?? null, created, response.round ?? 1);
  }

  setAnonymousId(runId, modelKey, anonymousId) {
    this.db.prepare('UPDATE model_responses SET anonymous_id = ? WHERE run_id = ? AND model_key = ? AND status = ?').run(anonymousId, runId, modelKey, 'success');
  }

  addReview(review) {
    const created = now();
    const provider = review.provider || {};
    this.db.prepare(`INSERT INTO reviews (id, run_id, reviewer_key, reviewer_model, provider_id, provider_type, provider_label, provider_base_url, status, review_json, error, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('rev'), review.runId, review.reviewerKey ?? review.reviewerModel, review.reviewerModel, provider.id ?? null, provider.type ?? null, provider.label ?? null, provider.baseUrl ?? null,
        review.status, review.review ? JSON.stringify(review.review) : null, review.error ?? null,
        review.latencyMs ?? null, review.usage?.prompt_tokens ?? null, review.usage?.completion_tokens ?? null, review.usage?.total_tokens ?? null, created, review.round ?? 1);
  }

  saveRanking(runId, ranking) {
    this.db.prepare('INSERT OR REPLACE INTO rankings VALUES (?, ?, ?)').run(runId, JSON.stringify(ranking), now());
  }

  addError(runId, scope, message) {
    this.db.prepare('INSERT INTO errors VALUES (?, ?, ?, ?, ?)').run(id('err'), runId, scope, message, now());
  }

  getRun(runId) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    return row ? normalizeRun(row) : null;
  }

  getConversation(conversationId) {
    const conversation = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) return null;
    return {
      ...conversation,
      messages: this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId),
      runs: this.db.prepare('SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at DESC').all(conversationId).map((row) => ({
        ...normalizeRun(row),
        responses: this.getResponses(row.id),
        reviews: this.getReviews(row.id),
        ranking: this.getRanking(row.id)
      }))
    };
  }

  listConversations() {
    return this.db.prepare(`SELECT c.*, (SELECT status FROM runs r WHERE r.conversation_id = c.id ORDER BY r.started_at DESC LIMIT 1) AS latest_status FROM conversations c ORDER BY updated_at DESC`).all();
  }

  getResponses(runId) {
    return this.db.prepare('SELECT * FROM model_responses WHERE run_id = ? ORDER BY created_at').all(runId);
  }

  getReviews(runId) {
    return this.db.prepare('SELECT * FROM reviews WHERE run_id = ? ORDER BY created_at').all(runId).map((row) => ({ ...row, review: parseJson(row.review_json) }));
  }

  getRanking(runId) {
    const row = this.db.prepare('SELECT ranking_json FROM rankings WHERE run_id = ?').get(runId);
    return row ? JSON.parse(row.ranking_json) : null;
  }

  getContext(conversationId, limit = 6) {
    return this.db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?').all(conversationId, limit).reverse();
  }

  deleteConversation(conversationId) {
    const runIds = this.db.prepare('SELECT id FROM runs WHERE conversation_id = ?').all(conversationId).map((r) => r.id);
    for (const runId of runIds) {
      this.db.prepare('DELETE FROM model_responses WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM reviews WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM rankings WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM errors WHERE run_id = ?').run(runId);
    }
    this.db.prepare('DELETE FROM runs WHERE conversation_id = ?').run(conversationId);
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  }
}

function normalizeRun(row) {
  return { ...row, config: parseJson(row.config_json), summary: parseJson(row.summary_json) };
}

function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(runs)').all().map((row) => row.name);
  if (!columns.includes('revealed_at')) db.exec('ALTER TABLE runs ADD COLUMN revealed_at TEXT');
  addColumn(db, 'model_responses', 'model_key TEXT');
  addColumn(db, 'model_responses', 'provider_id TEXT');
  addColumn(db, 'model_responses', 'provider_type TEXT');
  addColumn(db, 'model_responses', 'provider_label TEXT');
  addColumn(db, 'model_responses', 'provider_base_url TEXT');
  addColumn(db, 'reviews', 'reviewer_key TEXT');
  addColumn(db, 'reviews', 'provider_id TEXT');
  addColumn(db, 'reviews', 'provider_type TEXT');
  addColumn(db, 'reviews', 'provider_label TEXT');
  addColumn(db, 'reviews', 'provider_base_url TEXT');
  addColumn(db, 'model_responses', 'round INTEGER DEFAULT 1');
  addColumn(db, 'reviews', 'round INTEGER DEFAULT 1');
  db.exec(`
    UPDATE model_responses SET model_key = model WHERE model_key IS NULL;
    UPDATE reviews SET reviewer_key = reviewer_model WHERE reviewer_key IS NULL;
  `);
}

function addColumn(db, table, definition) {
  const name = definition.split(/\s+/)[0];
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function parseJson(value) {
  if (!value) return null;
  return JSON.parse(value);
}

function stringifyOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}
