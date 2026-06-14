# Plan de mejoras — Lang Chat

Revisión completa del código (~6000 líneas). Hallazgos priorizados y plan de ataque.
Marcar `[x]` al completar.

---

## Fase 1 — Código muerto y duplicación ✅ COMPLETADA

- [x] **13. `doc.usage` muerto** — quitado en `media/main.js`.
- [x] **14. `ToolHub.available()` / `McpManager.hasTools()`** — eliminados (`tools.ts`, `mcp.ts`).
- [~] **15. Adjunto kind `'text'`** — NO es código muerto: lo produce el webview pero ningún provider lo envía → es un **bug** (adjunto de texto descartado del prompt). Movido a Fase 3 (cablearlo).
- [x] **16. Lista de providers duplicada** — unificada en `providers/index.ts` (`PROVIDER_IDS`, `isProviderId`, `validateProvider`); reusada en `chatDocument.ts` y `extension.ts`.
- [x] **17. Boilerplate SSE/NDJSON** — extraído a `providers/stream.ts` (`readLines`), reusado en los 4 providers. **Bonus**: centraliza el cap del buffer (cubre item 4) y acota el `try/catch` a solo `JSON.parse` (parte de item 5). *(El helper de `baseUrl` se deja; es un one-liner, gana poco.)*
- [x] **18. `ChatVariant` redeclarado** — ahora usa el tipo único exportado en `providers/types.ts` (reexportado vía `providers/index.ts`) y consumido en `chatDocument.ts`. Sin redeclaraciones.

## Fase 2 — Rendimiento ✅ COMPLETADA

- [x] **1. [alto] `getDoc()` con caché** — `extension.ts`: cachea el parseo por `document.version` y devuelve un `structuredClone` (copia mutable independiente). Salta parse+validación en los hits.
- [x] **2. [alto] Render de streaming coalescido con rAF** — `main.js`: `streamDelta`/`streamReasoning` ya no re-parsean por token; se pinta como mucho 1 vez/frame (`queueStreamRender`/`flushStreamRender`). Render final síncrono en `streamEnd`.
- [x] **3. [medio] Memoización de `renderMarkdown`** — `main.js`: `renderConversation` re-renderiza todos los mensajes en cada cambio; ahora una caché LRU (cap 400) devuelve el HTML cacheado de los mensajes sin cambios. El streaming usa `renderMarkdownImpl` (raw) para no contaminar la caché.
  - *Nota: el re-render incremental con DOM diffing (en vez de `innerHTML=''` + rebuild) es un cambio mayor con riesgo de regresión; la memoización captura la mayor parte del beneficio con riesgo bajo. Diffing real queda como tarea futura si hace falta.*

## Fase 3 — Robustez / bugs ✅ COMPLETADA

- [x] **4. [alto] Buffers de stream sin límite** — cap en `providers/stream.ts` (`MAX_LINE_BUFFER`).
- [x] **5. [medio] Gemini/Ollama tragan errores de stream** — ahora detectan y **lanzan** el `error` embebido en el payload (además del try/catch acotado a `JSON.parse`).
- [x] **6. [medio] Procesos Piper no se matan al cancelar** — `currentPiperProc` + `killPiper()` en `ttsStop` y al iniciar una nueva petición.
- [x] **7. [medio] Ciclo de vida MCP** — `dispose()` rechaza pendientes + cierra stdin + suelta el proceso; `send()` ya no peta con `stdin!` si el proceso murió.
- [x] **8. [medio] Error de stream deja `streamingEl` colgado** — se limpia, quita cursor y suelta la referencia en `error`.
- [x] **9. [medio] `fs_read`/`fs_search` cargaban el archivo entero** — `fs_read` lee solo `limit` bytes (fd + readSync); `fs_search` hace `statSync` antes de leer.
- [x] **10. [medio] `dragleave` resaltado pegado** — contador `dragDepth`.
- [x] **11. [bajo-medio] `FileReader` sin `onerror`** — añadido `onerror`→reject en ambas lecturas; `addFiles` captura y avisa.
- [x] **12. [bajo-medio] `AudioContext` nunca se cierra** — `pagehide` lo cierra (un único contexto reutilizado en sesión; correcto).
- [~] **15. Adjunto kind `'text'`** — **FALSO POSITIVO**: `runInference` ya inlinea el texto del adjunto en el `content` (`[Archivo adjunto: …]`). El modelo sí lo ve. No es bug.

## Fase 4 — Hardening ✅ COMPLETADA

- [x] **19. [bajo] `inlineMd` allowlist de esquema en href** — bloquea `javascript:`/`data:`/`vbscript:`… (solo permite `http`/`https`/`mailto` y rutas relativas). Defensa en profundidad además de la CSP.

## Requires → imports ✅ COMPLETADO

- [x] Las 27 `require()` inline de `extension.ts` movidas a 5 imports de nivel módulo (`fs`/`path`/`os`/`https`/`child_process`); `pathmod` renombrado a `path`. Output sigue siendo CommonJS (verificado).

## Fase 5 — Integridad, rendimiento y fugas (2ª revisión) ✅ COMPLETADA

### Integridad / correctness
- [x] **1. `busy` protege todas las mutaciones** — guard añadido a `setConfig`/`deleteMessage`/`deleteFrom`/`mergeMessage`/`editMessage`/`setVariant`/`deleteVariant`.
- [x] **2. `AbortController` único por turno** — un solo `ac` para todo `runInference`, comprobado al inicio de cada iteración y **antes de cada tool** → Stop corta también durante el tool-loop. Se libera al final.
- [x] **3. Invariante de índices** — `parseDoc` filtra cualquier mensaje `system` → `doc.messages` nunca los tiene, los índices del webview siempre alinean.

### Rendimiento
- [x] **4. `writeDoc({save,prune})`** — las escrituras intermedias del tool-loop ya no hacen `save()` ni `pruneAttach`; se hacen una sola vez al final del turno.

### Fugas de recursos
- [x] **5. `exportHtml`** — borra el `.html` temporal a los 60 s.
- [x] **6. `downloadFile`** — `req.setTimeout(60s)` + limpia el `.part` en cualquier fallo (res o file).
- [x] **7. `synthChunk`** — la ruta de `error` también borra el WAV temporal.
- [x] **8. Setup de Piper** — `piperSetupPromise` (guard de concurrencia: no dos `pip install` a la vez; se reintenta tras fallo).

### Robustez menor
- [x] **9. `regenerateFrom`** — `busy=true` antes de mutar/escribir, todo en try/finally.
- [x] **10. `rafQueued`** — se resetea en `streamEnd` y `error`.
- [x] **11. `error`** — ahora hace `bindThinking` (conserva el badge de razonamiento parcial).

## Fase 6 — Seguridad (análisis de vulnerabilidades) ✅ COMPLETADA (S1-S5)

### Alto
- [x] **S1. Workspace Trust** — MCP no arranca en workspace no confiable (`mcp.ts`); `fs_write` también deshabilitado (`tools.ts`); `capabilities.untrustedWorkspaces: limited` en `package.json`.
- [x] **S2. `web_fetch` SSRF** — resuelve DNS y bloquea loopback/privadas/CGNAT/link-local/`169.254.169.254`/IPv6 internas; sigue redirects **a mano validando cada salto** (`tools.ts`). Filtro IP verificado con test.
- [x] **S3. Escritura peligrosa** — `assertWritable` deniega `.git/` y `.vscode/` en `fs_write`.

### Medio
- [x] **S4. `systemPromptFile` confinado** al directorio del `.chat` (`extension.ts resolveSystemPrompt`).
- [x] **S5. Escape por symlink** — `assertRealWithin` (realpath del ancestro existente) en `resolveInWorkspace`.

### Endurecimiento ✅ COMPLETADA
- [x] **S6 (voces). Integridad del modelo `.onnx`** — SHA256 **pineado** de las 6 voces curadas (de `lfs.oid` de HF) y verificado tras descargar; mismatch → borra + error. Verificado contra el modelo real.
- [x] **S6 (motor pip). Versión pineada** — `piper-tts==1.4.2` (PyPI); pip verifica su hash contra el índice. `PIPER_TTS_VERSION`, bumpear a conciencia.
- [x] **S6 (binario standalone). Checksum pineado** — SHA256 de los 4 tarballs de GitHub (`PIPER_ASSET_SHA256`), verificado **antes de extraer/ejecutar**.
- [x] **S6 (a) `--require-hashes`** — **decisión: no implementar** (coste/beneficio); documentado como riesgo residual aceptado en `SECURITY.md`. La versión pineada cubre los vectores realistas.
- [x] **`SECURITY.md`** creado: modelo de amenazas + todas las mitigaciones + residuales aceptados + cómo reportar.

## Fase 7 — Compatibilidad Windows ✅

- [x] **W1. `findCompatiblePython`** ahora incluye `py` y `python` (Windows) — antes solo `python3`/rutas Unix → el venv de Piper no arrancaba.
- [x] **W2. `tlog`** usa `os.tmpdir()` en vez de `/tmp` (no existe en Windows).
- [x] **W3. MCP `spawn`** con `shell: true` en Windows (`npx`/`node` son `.cmd` → ENOENT sin shell).
- [x] Verificado: rutas venv `Scripts/piper.exe`/`pip.exe` ya correctas; `DYLD`/`LD` solo en mac/linux.
- Notas: el **motor Sistema (Web Speech)** funciona en Windows con voces SAPI. El binario standalone no aplica a Windows (sería `.zip`, no se usa; el venv es el camino).
- [x] **W4. Python autocontenido propio (independencia total)** — la extensión usa **SIEMPRE** un CPython autocontenido propio (astral-sh/python-build-standalone 3.12.13, checksums pineados de los 5 SO) en globalStorage, **aislado del Python del sistema**. Inmune a que el dev rompa su Python / use pyenv·conda / tenga versión incompatible. Cae al Python del sistema **solo** si la plataforma no tiene build o falla la descarga. **Piper funciona sin Python preinstalado** en mac/win/linux. Probado end-to-end en mac: descarga→checksum→venv→`pip install piper-tts`→**audio WAV válido**.

## Fase 8 — Calidad / publicación (gaps)

- [x] **G1. API keys en `SecretStorage`** — comando **"Configurar API Key (segura)"** (QuickPick backend + input oculto) que guarda en `context.secrets` (cifrado). El provider resuelve `resolveApiKey()`: secret primero, ajuste de settings como fallback (migración suave). Recarga con `onDidChange`.
- [x] **G2. Soporte de proxy** — `src/http.ts`: `httpFetch` usa el `fetch` global si no hay proxy (cero cambios en el caso común), o **undici `ProxyAgent`** si hay `http.proxy`/`HTTPS_PROXY`. Los 5 sitios de fetch (4 providers + `web_fetch`) ahora usan `httpFetch`. `undici@6` (Node ≥18.17) como dep, empaquetado en el `.vsix`. Re-init al cambiar `http.*`.
- [x] **G3. Tests** — `net.ts`/`audio.ts` extraídos (sin `vscode`); suite `node --test` con **18 tests** verdes: SSRF (`ipIsPrivate`), audio (`splitForTTS`/`concatWavs`/`wavData`), streaming (`readLines`), **zoom** (`clampZoom`/`stepZoom`: topes, redondeo anti-deriva de float, dirección de rueda). Script `npm test`.

## Funcionalidades nuevas (post-Fase 8)

- [x] **Zoom propio del chat** — `media/zoom.js` (módulo doble-modo: global en webview + `require` en tests). **Alt/Option + rueda** acerca/aleja (0.6×–2.5×, paso 0.1), **Alt/Option + 0** resetea; se persiste en `vscode.setState`. Mismo modificador que el borrado en cascada (clic vs rueda → sin choque) y deja libre el `+/-` nativo de VS Code. Lógica pura extraída y testeada (6 tests).
- [x] **G4. `CHANGELOG.md`** creado.
- [x] **G5. CI** — `.github/workflows/ci.yml`: `npm ci` → compile → test → `vsce package` (sube el `.vsix`).
- [x] **G6. ESLint** — `eslint.config.js` (flat, type-aware: `no-floating-promises`, `no-unused-vars`…), script `npm run lint`, en CI. Resultado: **0 errores/0 warnings** (el TS estricto ya mantenía limpio; arreglados 2 `catch` sin usar).
- [x] **G7. Gate de debug TTS** — `tlog` tras `langChat.tts.debug` (off por defecto); cierra la deuda de debug.
- [x] **G8. Multi-root** — `resolveInWorkspace` prueba TODAS las carpetas del workspace y usa donde la ruta exista (lecturas multi-root); escrituras a la primera. Sin escape por `..`/symlink. (`fs_search`/`fs_glob` ya buscaban en todas vía `findFiles`.)
- También: `.vscodeignore` afinado (incluye prod deps como undici, excluye tests/internos).
