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
    maxOutputTokens: Number.parseInt(env.LLM_MAX_OUTPUT_TOKENS || '4096', 10),
    defaults: ['openai/gpt-5.5', 'openai/gpt-5.4', 'anthropic/claude-sonnet-4.6', 'google/gemini-3.1-pro-preview'],
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
    openRouterDefaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaults: config.defaults,
    criteria: config.criteria
  };
}
