export class OpenAICompatibleProvider {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ model, provider, messages, temperature = 0.2, signal, responseFormatJson = false, maxOutputTokens } = {}) {
    const callConfig = {
      apiBaseUrl: provider?.baseUrl || this.config.apiBaseUrl,
      apiKey: provider?.apiKey || this.config.apiKey,
      requestTimeoutMs: provider?.requestTimeoutMs || this.config.requestTimeoutMs,
      maxOutputTokens: maxOutputTokens || provider?.maxOutputTokens || this.config.maxOutputTokens
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timeout')), callConfig.requestTimeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    const started = performance.now();
    try {
      const body = {
        model: typeof model === 'string' ? model : model.model,
        messages,
        temperature,
        max_tokens: callConfig.maxOutputTokens
      };
      if (responseFormatJson) body.response_format = { type: 'json_object' };
      const headers = { 'content-type': 'application/json' };
      if (callConfig.apiKey) headers.authorization = `Bearer ${callConfig.apiKey}`;
      const response = await this.fetch(`${callConfig.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${safeProviderError(text, callConfig.apiKey)}`);
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

export function safeProviderError(text, apiKey = '') {
  let message = String(text || '');
  if (apiKey) message = message.split(apiKey).join('[redacted]');
  return message.slice(0, 300).replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}
