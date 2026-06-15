# Plan de incremento — Ollama embebido + explorador de modelos (estilo LM Studio)

Objetivo: que **Lang Chat** pueda gestionar un **servidor Ollama propio** (descargado y
controlado por la extensión) y ofrecer una **vista de modelos** en la barra lateral, con un
botón **"Agregar"** que abre un **explorador tipo LM Studio** para buscar y descargar modelos
GGUF desde **Hugging Face** (y la librería de Ollama).

> Estado: PROPUESTA. Marcar `[x]` al completar. Pensado para construirse en incrementos
> que dejan el plugin usable en cada fase (no es un big-bang).

---

## 0. Por qué Ollama es la base correcta

Apoyarnos en Ollama (en vez de embeber `llama.cpp` a pelo) nos da casi todo gratis y encaja
con lo que **ya existe** en el repo:

- Ya hay un **provider Ollama** funcionando (`src/providers/ollama.ts`, habla `/api/chat`,
  `/api/tags` vía `httpFetch`). El servidor embebido no es más que un Ollama en un `baseUrl`
  que nosotros gestionamos → **el chat ya sabe consumirlo**.
- Ollama descarga GGUF **directo de Hugging Face**: `ollama pull hf.co/{usuario}/{repo}:{quant}`.
  No tenemos que implementar el motor de inferencia ni la resolución de quants.
- API de gestión lista: `/api/pull` (descarga con **progreso en streaming**), `/api/tags`
  (locales), `/api/delete`, `/api/show` (metadatos + capacidades), `/api/ps` (en ejecución),
  `/api/version` (health).
- Ya tenemos la **infraestructura de descarga de binarios**: `downloadFile()` (timeout, limpieza
  de `.part`), `sha256File()`, verificación "fail-closed", Python autocontenido en
  `globalStorageUri`, gestión de procesos hijo (patrón de MCP/Piper). El binario de Ollama se
  gestiona **igual que ya gestionamos Piper**.

Conclusión: el grueso del trabajo es **UI + ciclo de vida del proceso + orquestación de la API**,
no inferencia. Riesgo técnico bajo, riesgo de UX/alcance medio.

---

## 1. Decisiones abiertas (resolver antes de Fase 3)

| # | Decisión | Opciones | Resolución |
|---|----------|----------|------------|
| D1 | ¿Embeber o usar Ollama del sistema? | (a) descargar y gestionar binario propio en globalStorage; (b) exigir Ollama instalado; (c) detectar el del sistema y, si no, ofrecer descargar | ✅ **(a) — descargar SIEMPRE el propio.** Independencia total (como el Python autocontenido): inmune a un Ollama del sistema roto/incompatible/no instalado. **No** se intenta reutilizar el del sistema. Descarga on-demand a globalStorage con SHA256 fail-closed. |
| D2 | Fuente de modelos en el explorador | (a) **Hugging Face** (API de búsqueda, filtro GGUF); (b) librería de Ollama (`ollamadb`/scrape); (c) ambas con pestañas | **(a) primero** (es lo que pediste), (c) como evolución. |
| D3 | Badges de capacidades (Vision / Tool Use / Reasoning) | (a) leer de `/api/show` **tras** descargar; (b) heurística por tags de HF; (c) catálogo curado propio | ✅ **(b)+(a) — heurística en la lista, verdad de `/api/show` tras bajar.** En resultados de búsqueda, badges deducidos de tags/nombre de HF (marcados como "estimado"); una vez descargado, se sustituyen por las `capabilities` reales de `/api/show`. Catálogo curado descartado (mantenimiento manual). |
| D4 | Tamaño/disco | Modelos de 4–30 GB. ¿Avisar? ¿límite? | ✅ **Mostrar tamaño y espacio libre ANTES de bajar.** Confirmación explícita con el tamaño a la vista; aviso si el espacio libre es insuficiente. Sin límite duro, pero nunca se descarga sin que el usuario vea cuánto ocupa. Gestor de borrado claro. |
| D5 | ¿Bundle del binario en el `.vsix`? | (a) no (descarga on-demand); (b) sí | ✅ **(a) — sin bundle.** El `.vsix` no debe pesar cientos de MB. Descarga on-demand con checksum, como Piper. |

---

## 2. Arquitectura (módulos nuevos)

```
src/ollama/
  manager.ts     # ciclo de vida: ensureBinary(), start(), stop(), health(), version()
  registry.ts    # API de gestión: listLocal(), pull(streaming), delete(), show()
  catalog.ts     # búsqueda en Hugging Face: search(), modelFiles(), capabilities heurísticas
  assets.ts      # URLs + SHA256 pineados del binario de Ollama por SO/arch (patrón Piper)
media/
  models.js      # webview del explorador (lista + detalle + descarga con progreso)
  models.css     # estilos del explorador (puede ir en style.css)
src/
  modelsView.ts  # TreeDataProvider de la barra lateral (estado servidor + modelos locales)
  modelsPanel.ts # WebviewPanel del explorador (el "Agregar")
```

Reutiliza sin tocar: `httpFetch` (proxy + SSRF), `downloadFile`/`sha256File`, `ipIsPrivate`,
`i18n.js`, el patrón CSP/nonce del webview, y el **provider Ollama existente** como consumidor.

---

## 3. Fases incrementales

### Fase A — Servidor Ollama gestionado (sin UI nueva)  ·  *MVP del backend*
- [ ] `assets.ts`: tabla `OLLAMA_VERSION` + URLs de release (GitHub `ollama/ollama`) + **SHA256
      pineado** por `darwin-arm64`/`darwin-amd64`/`linux-amd64`/`linux-arm64`/`windows-amd64`.
- [ ] `manager.ts`:
  - `ensureBinary()` — descarga **siempre el binario propio** (D1) a `globalStorageUri/ollama-bin`
    si no está ya; verifica SHA256 **antes de ejecutar** (fail-closed), `chmod +x`. No se busca ni
    usa el Ollama del sistema (independencia total, como el Python autocontenido).
  - `start()` — `spawn(ollama, ['serve'])` con `OLLAMA_HOST=127.0.0.1:<puerto libre>`; guarda el
    proceso (patrón `currentPiperProc`); `health()` por polling a `/api/version`.
  - `stop()`/`dispose()` — mata el proceso, cierra al desactivar la extensión.
  - Guard de concurrencia (`startPromise`) como `piperSetupPromise`.
- [ ] Settings nuevos: `langChat.ollama.managed` (bool, default true — al activarse usa el binario
      propio descargado, nunca el del sistema), `langChat.ollama.port` (0 = auto),
      `langChat.ollama.modelsPath` (opcional, `OLLAMA_MODELS`). Con `managed:false`, el usuario
      avanzado sigue pudiendo apuntar a un `baseUrl` externo (comportamiento actual).
- [ ] Cuando `managed` está activo, el `baseUrl` del provider Ollama apunta al servidor gestionado
      automáticamente (el chat funciona end-to-end con lo ya existente).
- [ ] Tests (sin red): parseo de versión, selección de asset por plataforma, construcción de URLs.

**Entregable:** el plugin levanta su propio Ollama y el chat puede usarlo. Sin UI todavía.

### Fase B — Vista lateral de modelos (TreeView)  ·  *la pantalla 1*
- [ ] `package.json`: `viewsContainers.activitybar` (icono propio) + `views` con un TreeView
      `langChat.models`.
- [ ] `modelsView.ts` (`TreeDataProvider`): secciones
  - **Servidor**: estado (parado/arrancando/listo), versión, botón arrancar/parar.
  - **Modelos locales** (`/api/tags`): nombre, tamaño, quant; acciones por ítem: *Usar en el chat*,
    *Mostrar info* (`/api/show`), *Eliminar* (`/api/delete`, con confirmación).
  - **En ejecución** (`/api/ps`) — opcional.
- [ ] Botón **"Agregar"** en `view/title` (icono `$(add)`) → abre el explorador (Fase C).
- [ ] Refresco: tras pull/delete y con un botón refrescar.
- [ ] i18n de todas las etiquetas.

**Entregable:** ves, usas y borras modelos locales desde la barra lateral.

### Fase C — Explorador tipo LM Studio (WebviewPanel)  ·  *la pantalla 2*
- [ ] `modelsPanel.ts`: abre un `WebviewPanel` (CSP estricta + nonce, como el editor de chat).
- [ ] `catalog.ts`:
  - `search(query, {limit})` → `GET https://huggingface.co/api/models?search=…&filter=gguf&full=true`
    vía `httpFetch`. Devuelve id, autor, descargas, ⭐, updatedAt.
  - `modelFiles(id)` → árbol/`siblings` filtrando `*.gguf`; agrupa por **quant** (Q4_0, Q4_K_M…)
    con su **tamaño**.
  - `capabilities(model)` → heurística por tags/nombre (vision, tools, reasoning) para los badges.
- [ ] `models.js` (webview): layout 2 columnas como la captura:
  - Izquierda: buscador + lista de resultados (logo, nombre, descripción, fecha).
  - Derecha: detalle (params, arch, formato, **badges de capacidades**, opciones de descarga con
    quant + tamaño, README via `GET …/raw/main/README.md`, "más del autor").
  - Botón **Download** por quant.
- [ ] Estados vacío/cargando/error; debounce del buscador; cancelar búsqueda en vuelo.

**Entregable:** buscas en HF y ves el detalle, igual que LM Studio. (La descarga, en Fase D.)

### Fase D — Descarga con progreso e integridad
- [ ] `registry.ts.pull(ref, onProgress)` → `POST /api/pull` con `stream:true`; parsea el NDJSON
      (`status`, `completed`, `total`) reutilizando el patrón `readLines` de `providers/stream.ts`.
- [ ] El `ref` de HF se arma como `hf.co/{id}:{quant}` (pull nativo de Ollama desde HF).
- [ ] Barra de progreso en el explorador y en la vista lateral (porcentaje + MB/s + ETA).
- [ ] Cancelable (AbortController; Ollama corta el pull al cerrar la conexión).
- [ ] Al terminar: refrescar locales, ofrecer **"Usar en el chat"**, validar con `/api/show`.
- [ ] Manejo de errores claros (sin espacio, red, quant inexistente) — mensajes accionables.

**Entregable:** flujo completo buscar → descargar (con progreso) → usar en el chat.

### Fase E — Integración con el chat
- [ ] El selector de modelo del chat ofrece los **locales del Ollama gestionado** sin configurar
      `baseUrl` a mano.
- [ ] Auto-arranque del servidor gestionado al elegir provider Ollama (lazy, con aviso).
- [ ] "Usar este modelo" desde la vista/explorador setea provider=ollama + model en el `.chat` activo.

### Fase F — Pulido / publicación
- [ ] i18n ES/EN completo de vista y explorador.
- [ ] Seguridad: todas las llamadas por `httpFetch` (proxy + SSRF ya cubiertos); binario con SHA256
      fail-closed; el servidor gestionado escucha **solo en 127.0.0.1**; Workspace Trust si aplica.
- [ ] `SECURITY.md`: nuevo apartado (binario Ollama, host local, descargas HF).
- [ ] Tests: `catalog` (parseo de respuestas HF mockeadas), `registry` (parseo NDJSON de progreso),
      `assets` (selección/URLs). Sin red real.
- [ ] `CHANGELOG.md`, `README.md` (sección "Modelos locales"), capturas.
- [ ] CI (`azure-pipelines.yml`) ya cubre compile/lint/test/package — sin cambios estructurales.

---

## 4. Endpoints y formatos (referencia rápida)

**Ollama (gestión):**
- `GET  /api/version` — health.
- `GET  /api/tags` — modelos locales (ya lo usa el provider).
- `POST /api/pull` `{name, stream:true}` — descarga; NDJSON `{status, digest, total, completed}`.
- `POST /api/show` `{name}` — detalles + `capabilities` (vision/tools/...).
- `POST /api/delete` `{name}` — borrar.
- `GET  /api/ps` — en ejecución.

**Hugging Face (catálogo):**
- `GET https://huggingface.co/api/models?search={q}&filter=gguf&full=true&limit={n}`
- `GET https://huggingface.co/api/models/{id}` — incluye `siblings` (ficheros).
- `GET https://huggingface.co/{id}/resolve/main/README.md` — README.
- Pull a Ollama: `ollama pull hf.co/{id}:{quant}` (ej. `hf.co/google/gemma-…-gguf:Q4_K_M`).

---

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Binario de Ollama grande (~1 GB con runners) | Descarga on-demand del binario propio (D1) a globalStorage, una sola vez, con checksum. No bundle en el `.vsix`. |
| Modelos enormes llenan el disco | Mostrar tamaño y **espacio libre antes** (D4); confirmación explícita; gestor de borrado. |
| Capacidades poco fiables desde HF | Heurística para la lista + verdad de `/api/show` tras bajar (D3). |
| HF/Ollama cambian formato de API | Aislar en `catalog.ts`/`registry.ts`; tests con respuestas mockeadas. |
| Choque de puertos | Puerto efímero libre + `OLLAMA_HOST=127.0.0.1`. |
| Seguridad de red | `httpFetch` (SSRF/proxy), servidor solo local, SHA256 fail-closed del binario. |

---

## 6. Corte MVP sugerido (primer entregable usable)

**A + B + (C/D mínimos):** servidor gestionado + vista lateral con locales (usar/borrar) +
explorador que **busca en HF y descarga por quant con progreso**. Sin badges curados, sin
pestaña de librería Ollama, sin “más del autor”. Eso ya replica el 80% de la captura y es
plenamente útil. El resto (badges finos, README enriquecido, catálogo curado) entra después.
