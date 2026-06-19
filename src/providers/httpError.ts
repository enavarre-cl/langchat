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
    hint = 'Quota or rate limit exceeded. Wait a few seconds or try another model ' +
      "(e.g. on Gemini's free tier the *-pro models aren't available; use gemini-2.5-flash).";
  } else if (status === 401 || status === 403) {
    hint = 'Authentication rejected. Check the API key in the settings (🔧).';
  } else if (status === 404) {
    hint = 'Not found. Check the selected model and the endpoint URL.';
  }

  let out = `${label} (${status}): ${msg}`;
  if (hint) out += `\n\n${hint}`;
  return out;
}
