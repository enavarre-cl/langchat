import { ChatMessage, ChatResult, GenerationParams, LLMProvider, ModelInfo, StreamCallbacks } from './types';
import { formatHttpError } from './httpError';
import { httpFetch } from '../http';
import { readLines } from './stream';
import { imageAttachments, documentAttachments } from './multimodal';

/**
 * Provider para la API de Google Gemini (Generative Language API).
 * Streaming vía streamGenerateContent?alt=sse.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-goog-api-key'] = this.apiKey;
    return h;
  }

  private base(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await httpFetch(`${this.base()}/models`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`No se pudieron listar los modelos de Gemini (${res.status} ${res.statusText})`);
    }
    const json: any = await res.json();
    const models = Array.isArray(json?.models) ? json.models : [];
    return models
      .filter((m: any) => Array.isArray(m.supportedGenerationMethods)
        && m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => ({
        id: String(m.name).replace(/^models\//, ''),
        contextLength: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : undefined,
      }))
      .filter((m: ModelInfo) => !!m.id);
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    p: GenerationParams,
    cb: StreamCallbacks
  ): Promise<ChatResult> {
    // Gemini separa el system en systemInstruction y usa roles user/model.
    const systemTexts: string[] = [];
    const contents: any[] = [];
    // Las respuestas de tools consecutivas se agrupan en un único content 'user'.
    let pendingFnResponses: any[] = [];
    const flushFns = () => {
      if (pendingFnResponses.length) {
        contents.push({ role: 'user', parts: pendingFnResponses });
        pendingFnResponses = [];
      }
    };
    for (const m of messages) {
      if (m.role === 'system') {
        if (m.content) systemTexts.push(m.content);
        continue;
      }
      if (m.role === 'tool') {
        pendingFnResponses.push({
          functionResponse: { name: m.toolName, response: { result: m.content } },
        });
        continue;
      }
      flushFns();
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          let args: any = {};
          try { args = JSON.parse(tc.arguments || '{}'); } catch { /* vacío */ }
          parts.push({ functionCall: { name: tc.name, args } });
        }
        contents.push({ role: 'model', parts });
        continue;
      }
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const a of imageAttachments(m)) {
        parts.push({ inline_data: { mime_type: a.mime, data: a.data } });
      }
      for (const a of documentAttachments(m)) {
        parts.push({ inline_data: { mime_type: a.mime, data: a.data } });
      }
      if (!parts.length) parts.push({ text: '' });
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    flushFns();

    const generationConfig: any = {};
    if (p.temperature !== undefined) generationConfig.temperature = p.temperature;
    if (p.maxTokens !== undefined && p.maxTokens > 0) generationConfig.maxOutputTokens = p.maxTokens;
    if (p.topP !== undefined) generationConfig.topP = p.topP;
    if (p.topK !== undefined) generationConfig.topK = p.topK;
    if (p.seed !== undefined) generationConfig.seed = p.seed;
    if (p.presencePenalty !== undefined) generationConfig.presencePenalty = p.presencePenalty;
    if (p.frequencyPenalty !== undefined) generationConfig.frequencyPenalty = p.frequencyPenalty;
    if (p.stop && p.stop.length) generationConfig.stopSequences = p.stop;
    if (p.thinking) generationConfig.thinkingConfig = { includeThoughts: true };

    const body: any = { contents, generationConfig };
    if (systemTexts.length) {
      body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
    }
    if (p.tools && p.tools.length) {
      body.tools = [{
        functionDeclarations: p.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeSchema(t.parameters),
        })),
      }];
    }

    const url = `${this.base()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await httpFetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: cb.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(formatHttpError('Gemini', res.status, res.statusText, detail));
    }

    const reader = res.body.getReader();
    let answer = '';
    let thinking = '';
    let usage: any;
    const toolCalls: { id: string; name: string; arguments: string }[] = [];

    await readLines(reader, (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        return; // Línea parcial o no-JSON: se ignora.
      }
      // Error embebido en el stream (no se traga: trunca silenciosamente si no).
      if (json?.error) {
        throw new Error(`Gemini (stream): ${json.error?.message ?? JSON.stringify(json.error)}`);
      }
      const um = json?.usageMetadata;
      if (um) {
        usage = {
          promptTokens: um.promptTokenCount || 0,
          completionTokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
          totalTokens: um.totalTokenCount || 0,
        };
      }
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part?.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${toolCalls.length}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          });
        } else if (typeof part?.text === 'string') {
          if (part.thought === true) {
            thinking += part.text;
            cb.onReasoning?.(part.text);
          } else {
            answer += part.text;
            cb.onDelta(part.text);
          }
        }
      }
    });

    return { answer, thinking, usage, toolCalls: toolCalls.length ? toolCalls : undefined };
  }
}

/** Limpia un JSON Schema para Gemini (no admite $schema, additionalProperties, etc.). */
function sanitizeSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'additionalProperties' || k === 'title' || k === 'default') continue;
    out[k] = sanitizeSchema(v);
  }
  return out;
}
