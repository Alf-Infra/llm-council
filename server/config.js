import fs from 'node:fs';
import path from 'node:path';

export function readPort(rootDir = process.cwd()) {
  const raw = process.env.PORT || fs.readFileSync(path.join(rootDir, 'PORT.txt'), 'utf8').trim();
  return Number.parseInt(raw, 10);
}

export function loadRuntimeConfig(env = process.env) {
  return {
    apiBaseUrl: env.LLM_API_BASE_URL || 'http://localhost:4000/v1',
    apiKey: env.LLM_API_KEY || '',
    requestTimeoutMs: Number.parseInt(env.LLM_REQUEST_TIMEOUT_MS || '120000', 10),
    maxOutputTokens: Number.parseInt(env.LLM_MAX_OUTPUT_TOKENS || '2048', 10),
    defaults: ['gpt-5.5', 'gpt-5.4', 'claude-sonnet-4-6', 'gemini-3-pro-preview'],
    criteria: [
      { id: 'correctness', label: 'Korrektheit', defaultWeight: 1 },
      { id: 'depth', label: 'Tiefe', defaultWeight: 1 },
      { id: 'usefulness', label: 'Praxisnutzen', defaultWeight: 1 }
    ]
  };
}

export function safeUiConfig(config = loadRuntimeConfig()) {
  return {
    apiBaseUrlConfigured: Boolean(config.apiBaseUrl),
    requestTimeoutMs: config.requestTimeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    defaults: config.defaults,
    criteria: config.criteria
  };
}
