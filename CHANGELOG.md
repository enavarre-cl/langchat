# Changelog

Todos los cambios notables de Lang Chat. Formato basado en
[Keep a Changelog](https://keepachangelog.com/); versionado [SemVer](https://semver.org/).

## [Sin publicar]

### Añadido
- **TTS neural con Piper** (motor local, sin censura) además del motor del sistema (Web Speech):
  selector de voces femeninas ES/EN, velocidad, botón de prueba y lectura por mensaje.
- **Python autocontenido**: si no hay (o está roto) un Python del sistema, la extensión descarga
  su propio CPython (con checksum pineado) para ejecutar Piper. Cero requisitos.
- Internacionalización **ES/EN** (UI del webview + ajustes del marketplace) con selector y auto-detección.
- Botón **Regenerar** en el mensaje de usuario y borrado **⌥/Alt** (este y los de abajo).
- `SECURITY.md` con modelo de amenazas.

### Seguridad
- **Workspace Trust**: MCP y `fs_write` solo en workspaces de confianza.
- **Anti-SSRF** en `web_fetch` (bloquea loopback/privadas/metadatos; valida redirects).
- Confinamiento de rutas (traversal/symlink) en las tools y `systemPromptFile`.
- Integridad pineada (SHA256) de modelos/binarios Piper y del Python autocontenido; `piper-tts` con versión fijada.

### Rendimiento
- Caché de parseo del `.chat`; render de streaming coalescido (rAF); memoización de markdown.

### Corregido
- Múltiples arreglos de robustez del TTS, del tool-loop (Stop, `busy`), fugas de recursos y compatibilidad Windows.
