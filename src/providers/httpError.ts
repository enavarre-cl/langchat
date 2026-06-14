/**
 * Convierte una respuesta de error HTTP (cuyo cuerpo suele ser JSON tipo
 * {error:{message}} o {error:"..."}) en un mensaje legible, con pistas según el código.
 */
export function formatHttpError(
  label: string,
  status: number,
  statusText: string,
  body: string
): string {
  let msg = '';
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message ?? (typeof j?.error === 'string' ? j.error : '');
  } catch {
    msg = body;
  }
  msg = (msg || statusText || '').trim();
  if (msg.length > 500) msg = msg.slice(0, 500) + '…';

  let hint = '';
  if (status === 429) {
    hint = 'Cuota o límite de tasa superado. Espera unos segundos o prueba con otro modelo ' +
      '(p. ej. en el free tier de Gemini, los modelos *-pro no están disponibles; usa gemini-2.5-flash).';
  } else if (status === 401 || status === 403) {
    hint = 'Autenticación rechazada. Revisa la API key en los ajustes (🔧).';
  } else if (status === 404) {
    hint = 'No encontrado. Revisa el modelo seleccionado y la URL del endpoint.';
  }

  let out = `${label} (${status}): ${msg}`;
  if (hint) out += `\n\n${hint}`;
  return out;
}
