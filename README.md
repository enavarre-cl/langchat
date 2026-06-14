# Lang Chat

Extensión de VS Code para chatear con LLMs locales — estilo **LM Studio** — directamente dentro del editor.

Soporta dos backends configurables:

- **OpenAI-compatible**: LM Studio, llama.cpp server, vLLM, LocalAI… (por defecto `http://localhost:1234/v1`)
- **Ollama**: servidor local de Ollama (`http://localhost:11434`)

## Archivos `.chat`

Cada conversación es un archivo **`.chat`** (JSON legible) que guarda **la configuración de
inferencia + el historial completo**. Al abrirlo en VS Code se muestra la interfaz de chat;
todo lo que hablas y configuras se persiste en el propio archivo, así que es versionable en git.

```json
{
  "version": 1,
  "title": "Mi conversación",
  "provider": "openai",
  "model": "llama-3.1-8b-instruct",
  "systemPrompt": "Eres un asistente útil.",
  "temperature": 0.7,
  "maxTokens": 2048,
  "messages": [
    { "role": "user", "content": "Hola" },
    { "role": "assistant", "content": "¡Hola! ¿En qué te ayudo?" }
  ]
}
```

## Tools (function calling)

Con el toggle **«Tools»** activo (en ⚙, disponible con todos los backends: OpenAI-compatible, OpenRouter, Gemini, Anthropic y Ollama), el modelo puede llamar a herramientas en un bucle agéntico:

- **Filesystem del workspace** (nativo, sin configurar nada): `fs_list`, `fs_read`, `fs_write`, acotados a la carpeta del workspace.
- **Servidores MCP**: define servidores en una carpeta **`.mcp/`** (un `*.json` por servidor) o en un **`.mcp.json`** en la raíz del workspace. Formatos aceptados:

  ```jsonc
  // .mcp.json (formato estándar)
  {
    "mcpServers": {
      "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ruta"] },
      "git": { "command": "uvx", "args": ["mcp-server-git"] }
    }
  }
  ```
  ```jsonc
  // .mcp/miservidor.json (un servidor por archivo)
  { "name": "miservidor", "command": "node", "args": ["server.js"], "env": { "API_KEY": "..." } }
  ```

Las tools de cada servidor MCP se exponen como `servidor__tool`. Las llamadas y resultados se muestran en el chat y se guardan en el `.chat`.

## Características

- 📄 Conversaciones como **archivos `.chat`** (config de inferencia + historial, editables y versionables).
- 💬 Respuestas en **streaming** token a token.
- 🧠 **System prompt**, **modelo**, **backend**, `temperature` y `maxTokens` por archivo.
- 🔀 **Selector de modelo** que lista los modelos disponibles del backend.
- ⛔ Botón para **detener** la generación en curso.
- 💾 Auto-guardado tras cada respuesta.

## Cómo probarla

1. Instala dependencias y compila:
   ```bash
   npm install
   npm run compile
   ```
2. Abre la carpeta en VS Code y pulsa **F5** (configuración «Ejecutar extensión»).
   Se abre una ventana *Extension Development Host*.
3. Crea un chat: paleta de comandos (`Cmd/Ctrl+Shift+P`) → **«Lang Chat: Nuevo chat»**,
   elige dónde guardar el archivo `.chat` y empieza a chatear.
   (También puedes crear un archivo con extensión `.chat` a mano y abrirlo.)

> Asegúrate de tener LM Studio (con su servidor local activado) u Ollama corriendo antes de enviar mensajes.

## Configuración

Ajustes en `Settings → Lang Chat`:

| Ajuste | Por defecto | Descripción |
| --- | --- | --- |
| `langChat.provider` | `openai` | Backend por defecto: `openai`, `ollama` o `gemini` |
| `langChat.openai.baseUrl` | `http://localhost:1234/v1` | Endpoint OpenAI-compatible |
| `langChat.openai.apiKey` | _(vacío)_ | API key opcional |
| `langChat.ollama.baseUrl` | `http://localhost:11434` | URL del servidor Ollama |
| `langChat.gemini.apiKey` | _(vacío)_ | API key de Google Gemini (Google AI Studio) |
| `langChat.gemini.baseUrl` | `https://generativelanguage.googleapis.com/v1beta` | Endpoint de la Generative Language API |
| `langChat.anthropic.apiKey` | _(vacío)_ | API key de Anthropic Claude (console.anthropic.com) |
| `langChat.anthropic.baseUrl` | `https://api.anthropic.com/v1` | Endpoint de la Messages API de Anthropic |
| `langChat.temperature` | `0.7` | Temperatura de muestreo |
| `langChat.maxTokens` | `2048` | Máx. tokens (`-1` = sin límite) |

## Empaquetar (opcional)

```bash
npm install -g @vscode/vsce
vsce package
```

Genera un `.vsix` instalable con **Extensions → Install from VSIX…**.
