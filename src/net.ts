/** Pure network utilities (no VS Code dependency), testable in isolation. */

/** Is an IP loopback / private / link-local (cloud metadata)? — for blocking SSRF. */
export function ipIsPrivate(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 (metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return ipIsPrivate(x.slice(7)); // IPv4-mapped
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true; // fe80::/10 link-local
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // ULA fc00::/7
  return false;
}

export interface ResolvedAddr { address: string; family: number }

/**
 * Shapes the result of a wildcard `dns.lookup` for a Node connect `lookup` callback. Drops
 * private/internal/metadata IPs (SSRF) and returns the shape Node expects: an ARRAY when Node
 * requested `all` (Node 20+ enables `autoSelectFamily`/happy-eyeballs, which calls the custom
 * `lookup` with `all:true` and then reads `.address` off each returned entry — handing it a bare
 * string there throws `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`), otherwise a single
 * `{address,family}`. Returns `null` when every resolved address is private (caller rejects as SSRF).
 */
export function safeLookupShape(
  addresses: readonly ResolvedAddr[],
  all: boolean | undefined,
): ResolvedAddr[] | ResolvedAddr | null {
  const safe = addresses.filter((a) => !ipIsPrivate(a.address));
  if (!safe.length) return null;
  return all ? safe : safe[0];
}
