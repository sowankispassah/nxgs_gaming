/**
 * Converts a stored artwork path into a URL the renderer can load.
 * Remote, file, data and blob URLs pass through unchanged; Windows paths
 * become file URLs.
 */
export function toFileUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}
