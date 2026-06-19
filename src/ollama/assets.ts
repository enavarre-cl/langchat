/** Ollama binary assets (GitHub release). Pure, testable. */

// Pinned release version. Bump deliberately after reviewing the changelog.
export const OLLAMA_VERSION = 'v0.30.8';

// Pinned SHA256 for each asset (from the `digest` field of the GitHub release, immutable bytes).
// Verifying before extracting/executing protects against corruption and tampered origin (fail-closed).
export const OLLAMA_ASSET_SHA256: Record<string, string> = {
  'ollama-darwin.tgz': '52acbca4e89c53db9abc586a22b5633fd101db293177264b9a0fe5d64a42a064',
  'ollama-linux-amd64.tar.zst': 'ffe2b2c2f2f5f5b30c081ec353c2e0bb2d9ead516064a8e22663b24b8fd8dca0',
  'ollama-linux-arm64.tar.zst': '668a6f934b0b0455128bb4a76c9e50b9e5f274f9dc7710a066b7073e5bd36588',
  'ollama-windows-amd64.zip': 'c2d26d97e698027329c252629d7113bbc05d874b49960cbb03e93a39ae9fd95c',
  'ollama-windows-arm64.zip': '487fa170d6eedc3ce12fbf144a39970d8322c4c6efbaa9a366ad7aa8769f5713',
};

export type ArchiveFormat = 'gz' | 'zst' | 'zip';

/** Asset name for the platform/arch (or null if unsupported). macOS is universal (single .tgz). */
export function ollamaAsset(platform: string, arch: string): string | null {
  if (platform === 'darwin') return 'ollama-darwin.tgz';
  if (platform === 'linux') return arch === 'arm64' ? 'ollama-linux-arm64.tar.zst' : 'ollama-linux-amd64.tar.zst';
  if (platform === 'win32') return arch === 'arm64' ? 'ollama-windows-arm64.zip' : 'ollama-windows-amd64.zip';
  return null;
}

/** Archive format of the asset, used to choose the extraction command. */
export function assetFormat(asset: string): ArchiveFormat {
  if (asset.endsWith('.tgz') || asset.endsWith('.tar.gz')) return 'gz';
  if (asset.endsWith('.tar.zst')) return 'zst';
  return 'zip';
}

/** Download URL of the asset in the pinned release. */
export function ollamaAssetUrl(asset: string): string {
  return `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/${asset}`;
}

/** Ollama executable name for the given OS. */
export function ollamaBinName(platform: string): string {
  return platform === 'win32' ? 'ollama.exe' : 'ollama';
}
