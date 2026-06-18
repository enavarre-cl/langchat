import { ChatMessage, ChatVariant, GenerationParams, ProviderId, TokenUsage, validateProvider } from './providers';

/** Parámetro que se puede activar/desactivar, con su valor numérico. */
export interface Toggle {
  enabled: boolean;
  value: number;
}

/** Configuración de inferencia almacenada en el archivo `.chat`. */
export interface ChatParams {
  temperature: number; // siempre activo
  maxTokens: Toggle; // límite de longitud de respuesta
  contextMessages: Toggle; // ventana de contexto: nº de últimos mensajes a enviar
  contextLength: Toggle; // num_ctx, tamaño de contexto del modelo (Ollama)
  numThreads: Toggle; // CPU threads (Ollama)
  topK: Toggle;
  topP: Toggle;
  minP: Toggle;
  topA: Toggle; // sampler de OpenRouter
  repeatPenalty: Toggle;
  presencePenalty: Toggle;
  frequencyPenalty: Toggle;
  seed: Toggle;
  stop: string[]; // stop strings
  thinking: boolean; // modo razonamiento en Ollama (think: true)
  autoSummary: boolean; // al saturar la ventana de contexto, resume lo viejo
  tools: boolean; // habilita tools (filesystem nativo + servidores MCP)
}

/** Resumen acumulado del contexto antiguo (compactación). Cubre messages[0..upTo). */
export interface ChatSummary {
  text: string;
  upTo: number;
}

export interface ChatDoc {
  version: number;
  title: string;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  systemPromptFile?: string; // ruta a un .md (relativa al .chat); si existe, prevalece
  spellLang?: 'auto' | 'off' | 'es' | 'en'; // idioma del corrector (per-chat). Ausente/'auto' = sistema
  params: ChatParams;
  summary?: ChatSummary;
  usage?: TokenUsage; // tokens acumulados del chat
  messages: ChatMessage[];
}

export interface ChatDefaults {
  provider: ProviderId;
  temperature: number;
  maxTokens: number;
}

const t = (enabled: boolean, value: number): Toggle => ({ enabled, value });

export function defaultParams(defaults: ChatDefaults): ChatParams {
  return {
    temperature: defaults.temperature,
    maxTokens: t(false, defaults.maxTokens > 0 ? defaults.maxTokens : 2048),
    contextMessages: t(false, 20),
    contextLength: t(false, 4096),
    numThreads: t(false, 4),
    topK: t(false, 40),
    topP: t(true, 0.95),
    minP: t(true, 0.05),
    topA: t(false, 0),
    repeatPenalty: t(true, 1.1),
    presencePenalty: t(false, 0),
    frequencyPenalty: t(false, 0),
    seed: t(false, 0),
    stop: [],
    thinking: false,
    autoSummary: false,
    tools: false,
  };
}

export function defaultDoc(defaults: ChatDefaults): ChatDoc {
  return {
    version: 2,
    title: 'Nuevo chat',
    provider: defaults.provider,
    model: '',
    systemPrompt: 'Eres un asistente útil.',
    params: defaultParams(defaults),
    messages: [],
  };
}

function num(v: any, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

/** Normaliza un Toggle leído de JSON, tolerando formatos antiguos/parciales. */
function toggle(v: any, def: Toggle): Toggle {
  if (typeof v === 'number') return { enabled: true, value: v };
  if (v && typeof v === 'object') {
    return { enabled: !!v.enabled, value: num(v.value, def.value) };
  }
  return { ...def };
}

/** Parsea el texto de un archivo `.chat`. Migra el formato v1 a v2. Lanza si el JSON es inválido. */
export function parseDoc(text: string, defaults: ChatDefaults): ChatDoc {
  if (!text || !text.trim()) return defaultDoc(defaults);

  const raw = JSON.parse(text);
  const base = defaultDoc(defaults);
  const dp = base.params;
  // Soporta tanto el nuevo `params` como los campos sueltos del formato v1.
  const rp = raw.params && typeof raw.params === 'object' ? raw.params : raw;

  const params: ChatParams = {
    temperature: num(rp.temperature, dp.temperature),
    maxTokens: toggle(rp.maxTokens, dp.maxTokens),
    contextMessages: toggle(rp.contextMessages, dp.contextMessages),
    contextLength: toggle(rp.contextLength, dp.contextLength),
    numThreads: toggle(rp.numThreads, dp.numThreads),
    topK: toggle(rp.topK, dp.topK),
    topP: toggle(rp.topP, dp.topP),
    minP: toggle(rp.minP, dp.minP),
    topA: toggle(rp.topA, dp.topA),
    repeatPenalty: toggle(rp.repeatPenalty, dp.repeatPenalty),
    presencePenalty: toggle(rp.presencePenalty, dp.presencePenalty),
    frequencyPenalty: toggle(rp.frequencyPenalty, dp.frequencyPenalty),
    seed: toggle(rp.seed, dp.seed),
    stop: Array.isArray(rp.stop) ? rp.stop.filter((s: any) => typeof s === 'string') : [],
    thinking: typeof rp.thinking === 'boolean' ? rp.thinking : false,
    autoSummary: typeof rp.autoSummary === 'boolean' ? rp.autoSummary : false,
    tools: typeof rp.tools === 'boolean' ? rp.tools : false,
  };

  const summary =
    raw.summary && typeof raw.summary.text === 'string' && typeof raw.summary.upTo === 'number'
      ? { text: raw.summary.text, upTo: raw.summary.upTo }
      : undefined;

  const usage: TokenUsage | undefined =
    raw.usage && typeof raw.usage === 'object'
      ? {
          promptTokens: Number(raw.usage.promptTokens) || 0,
          completionTokens: Number(raw.usage.completionTokens) || 0,
          totalTokens: Number(raw.usage.totalTokens) || 0,
        }
      : undefined;
  if (usage && typeof raw.usage.cost === 'number') usage.cost = raw.usage.cost;

  return {
    version: 2,
    title: typeof raw.title === 'string' ? raw.title : base.title,
    provider: validateProvider(raw.provider),
    model: typeof raw.model === 'string' ? raw.model : '',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : base.systemPrompt,
    systemPromptFile: typeof raw.systemPromptFile === 'string' && raw.systemPromptFile ? raw.systemPromptFile : undefined,
    spellLang: ['auto', 'off', 'es', 'en'].includes(raw.spellLang) ? raw.spellLang : undefined,
    params,
    summary,
    usage,
    messages: Array.isArray(raw.messages)
      ? raw.messages
          // Nunca persistimos mensajes 'system' (el system prompt vive aparte). Filtrarlos
          // mantiene el invariante de que los índices del webview == índices de doc.messages.
          .filter((m: any) => m && typeof m.content === 'string' && typeof m.role === 'string' && m.role !== 'system')
          .map((m: any) => {
            const msg: ChatMessage = { role: m.role, content: m.content };
            if (typeof m.id === 'string') msg.id = m.id;
            if (typeof m.ts === 'string') msg.ts = m.ts;
            if (m.usage && typeof m.usage === 'object') {
              msg.usage = {
                promptTokens: Number(m.usage.promptTokens) || 0,
                completionTokens: Number(m.usage.completionTokens) || 0,
                totalTokens: Number(m.usage.totalTokens) || 0,
              };
              if (typeof m.usage.cost === 'number') msg.usage.cost = m.usage.cost;
            }
            if (typeof m.thinking === 'string' && m.thinking) msg.thinking = m.thinking;
            if (Array.isArray(m.toolCalls)) {
              msg.toolCalls = m.toolCalls
                .filter((t: any) => t && typeof t.name === 'string')
                .map((t: any) => ({ id: String(t.id ?? ''), name: t.name, arguments: String(t.arguments ?? '{}') }));
            }
            if (typeof m.toolCallId === 'string') msg.toolCallId = m.toolCallId;
            if (typeof m.toolName === 'string') msg.toolName = m.toolName;
            if (Array.isArray(m.attachments)) {
              const atts = m.attachments
                .filter((a: any) => a && (a.kind === 'image' || a.kind === 'text' || a.kind === 'document')
                  && (typeof a.data === 'string' || typeof a.ref === 'string'))
                .map((a: any) => {
                  const o: any = {
                    kind: a.kind,
                    name: typeof a.name === 'string' ? a.name : 'adjunto',
                    mime: typeof a.mime === 'string' ? a.mime : 'application/octet-stream',
                  };
                  if (typeof a.ref === 'string') o.ref = a.ref;
                  if (typeof a.data === 'string') o.data = a.data; // compat: adjuntos inline antiguos
                  return o;
                });
              if (atts.length) msg.attachments = atts;
            }
            if (Array.isArray(m.variants)) {
              const variants = m.variants
                .filter((v: any) => v && typeof v.content === 'string')
                .map((v: any) => {
                  const o: ChatVariant = { content: v.content };
                  if (typeof v.thinking === 'string' && v.thinking) o.thinking = v.thinking;
                  if (v.usage && typeof v.usage === 'object') {
                    o.usage = {
                      promptTokens: Number(v.usage.promptTokens) || 0,
                      completionTokens: Number(v.usage.completionTokens) || 0,
                      totalTokens: Number(v.usage.totalTokens) || 0,
                    };
                    if (typeof v.usage.cost === 'number') o.usage.cost = v.usage.cost;
                  }
                  return o;
                });
              if (variants.length > 1) {
                msg.variants = variants;
                msg.active = typeof m.active === 'number' && m.active >= 0 && m.active < variants.length
                  ? m.active : variants.length - 1;
              }
            }
            return msg;
          })
      : [],
  };
}

export function serializeDoc(doc: ChatDoc): string {
  const ordered: ChatDoc = {
    version: 2,
    title: doc.title,
    provider: doc.provider,
    model: doc.model,
    systemPrompt: doc.systemPrompt,
    systemPromptFile: doc.systemPromptFile,
    spellLang: doc.spellLang,
    params: {
      temperature: doc.params.temperature,
      maxTokens: doc.params.maxTokens,
      contextMessages: doc.params.contextMessages,
      contextLength: doc.params.contextLength,
      numThreads: doc.params.numThreads,
      topK: doc.params.topK,
      topP: doc.params.topP,
      minP: doc.params.minP,
      topA: doc.params.topA,
      repeatPenalty: doc.params.repeatPenalty,
      presencePenalty: doc.params.presencePenalty,
      frequencyPenalty: doc.params.frequencyPenalty,
      seed: doc.params.seed,
      stop: doc.params.stop,
      thinking: doc.params.thinking,
      autoSummary: doc.params.autoSummary,
      tools: doc.params.tools,
    },
    summary: doc.summary,
    usage: doc.usage,
    messages: doc.messages,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Convierte la config del documento en los parámetros que se envían al backend (solo los activos). */
export function resolveGenerationParams(p: ChatParams): GenerationParams {
  const g: GenerationParams = { temperature: p.temperature };
  if (p.maxTokens.enabled) g.maxTokens = p.maxTokens.value;
  if (p.contextLength.enabled) g.contextLength = p.contextLength.value;
  if (p.numThreads.enabled) g.numThreads = p.numThreads.value;
  if (p.topK.enabled) g.topK = p.topK.value;
  if (p.topP.enabled) g.topP = p.topP.value;
  if (p.minP.enabled) g.minP = p.minP.value;
  if (p.topA.enabled) g.topA = p.topA.value;
  if (p.repeatPenalty.enabled) g.repeatPenalty = p.repeatPenalty.value;
  if (p.presencePenalty.enabled) g.presencePenalty = p.presencePenalty.value;
  if (p.frequencyPenalty.enabled) g.frequencyPenalty = p.frequencyPenalty.value;
  if (p.seed.enabled) g.seed = p.seed.value;
  if (p.stop.length) g.stop = p.stop;
  if (p.thinking) g.thinking = true;
  return g;
}
