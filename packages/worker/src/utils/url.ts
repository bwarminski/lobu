/**
 * Ensure a URL has a proper protocol prefix
 * @param base - The base URL that may or may not have a protocol
 * @returns URL with http:// or https:// prefix
 */
export function ensureBaseUrl(base: string): string {
  if (!base.startsWith("http")) {
    return `http://${base.replace(/^\/+/, "")}`;
  }
  return base;
}
