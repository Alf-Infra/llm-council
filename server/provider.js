export class OpenAICompatibleProvider {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ model, messages, temperature = 0.2, signal, responseFormatJson = false }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timeout')), this.config.requestTimeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    const started = performance.now();
    try {
      const body = {
        model,
        messages,
        temperature,
        max_tokens: this.config.maxOutputTokens
      };
      if (responseFormatJson) body.response_format = { type: 'json_object' };
      const headers = { 'content-type': 'application/json' };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
      const response = await this.fetch(`${this.config.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${safeProviderError(text)}`);
      const json = JSON.parse(text);
      return {
        content: json.choices?.[0]?.message?.content || '',
        usage: json.usage || null,
        latencyMs: Math.round(performance.now() - started)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeProviderError(text) {
  return String(text || '').slice(0, 300).replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}
