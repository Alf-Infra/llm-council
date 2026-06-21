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
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_responses (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      model TEXT NOT NULL,
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
      reviewer_model TEXT NOT NULL,
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

  addResponse(response) {
    const created = now();
    this.db.prepare(`INSERT INTO model_responses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('res'), response.runId, response.model, response.anonymousId ?? null, response.status, response.content ?? null, response.error ?? null,
        response.latencyMs ?? null, response.usage?.prompt_tokens ?? null, response.usage?.completion_tokens ?? null, response.usage?.total_tokens ?? null, created);
  }

  setAnonymousId(runId, model, anonymousId) {
    this.db.prepare('UPDATE model_responses SET anonymous_id = ? WHERE run_id = ? AND model = ? AND status = ?').run(anonymousId, runId, model, 'success');
  }

  addReview(review) {
    const created = now();
    this.db.prepare(`INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('rev'), review.runId, review.reviewerModel, review.status, review.review ? JSON.stringify(review.review) : null, review.error ?? null,
        review.latencyMs ?? null, review.usage?.prompt_tokens ?? null, review.usage?.completion_tokens ?? null, review.usage?.total_tokens ?? null, created);
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
}

function normalizeRun(row) {
  return { ...row, config: parseJson(row.config_json), summary: parseJson(row.summary_json) };
}

function parseJson(value) {
  if (!value) return null;
  return JSON.parse(value);
}

function stringifyOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}
