/** Utilidades de red puras (sin dependencias de VS Code), testeables de forma aislada. */

/** ¿Es una IP de loopback / privada / link-local (metadatos cloud)? — para bloquear SSRF. */
export function ipIsPrivate(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 (metadatos)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return ipIsPrivate(x.slice(7)); // IPv4-mapeada
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true; // fe80::/10
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // ULA fc00::/7
  return false;
}
