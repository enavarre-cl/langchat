export interface ChatVariant {
  content: string;
  thinking?: string;
  usage?: TokenUsage;
}

/** Adjunto de un mensaje: imagen, documento (PDF…) en base64, o archivo de texto. */
export interface Attachment {
  kind: 'image' | 'text' | 'document';
  name: string;
  mime: string;
  data?: string; // contenido resuelto (en memoria / wire / webview)
  ref?: string;  // id de la entrada en el sidecar .attach (lo que se guarda en el .chat)
}

export interface ToolSchema {
  name: string;
  description?: string;
  parameters: any; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON serializado de los argumentos
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number; // coste en USD, si el backend lo reporta (OpenRouter)
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  id?: string; // identificador estable del mensaje
  ts?: string; // marca de tiempo ISO 8601 de creación
  usage?: TokenUsage; // tokens usados (en respuestas del asistente)
  /** Razonamiento del modelo. Se guarda para mostrarlo, pero NO se reenvía al backend. */
  thinking?: string;
  attachments?: Attachment[];
  /** Llamadas a tools que pidió el asistente. */
  toolCalls?: ToolCall[];
  /** Para mensajes de rol 'tool': id de la llamada que responden y nombre de la tool. */
  toolCallId?: string;
  toolName?: string;
  /** Variantes generadas por reproceso (solo asistente). content/thinking reflejan la activa. */
  variants?: ChatVariant[];
  active?: number;
}

/**
 * Parámetros de generación. Todos opcionales: solo se envían al backend los que
 * el usuario tiene activados en el archivo `.chat`.
 */
export interface GenerationParams {
  temperature?: number;
  maxTokens?: number; // límite de tokens de respuesta
  topK?: number;
  topP?: number;
  minP?: number;
  topA?: number; // sampler de OpenRouter
  repeatPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stop?: string[];
  numThreads?: number; // num_thread (Ollama)
  contextLength?: number; // num_ctx (Ollama)
  thinking?: boolean; // activa el modo de razonamiento en Ollama (think: true)
  tools?: ToolSchema[]; // tools disponibles (function calling)
}

export interface StreamCallbacks {
  onDelta: (text: string) => void; // contenido de la respuesta
  onReasoning?: (text: string) => void; // razonamiento (thinking)
  signal: AbortSignal;
}

export interface ModelInfo {
  id: string;
  contextLength?: number; // tamaño de la ventana de contexto en tokens, si el backend lo expone
  // Capacidades (las que el backend declare):
  vision?: boolean;
  files?: boolean;
  audio?: boolean;
  tools?: boolean;
  reasoning?: boolean;
}

export interface ChatResult {
  answer: string;
  thinking: string;
  toolCalls?: ToolCall[]; // si el modelo pidió ejecutar tools
  usage?: TokenUsage; // tokens reportados por el backend
}

/**
 * Abstracción común para cualquier backend de LLM (OpenAI-compatible u Ollama).
 */
export interface LLMProvider {
  readonly id: string;
  /** Lista los modelos disponibles en el backend. */
  listModels(): Promise<ModelInfo[]>;
  /** Genera una respuesta en streaming. Devuelve respuesta y razonamiento por separado. */
  chat(
    model: string,
    messages: ChatMessage[],
    params: GenerationParams,
    cb: StreamCallbacks
  ): Promise<ChatResult>;
}
