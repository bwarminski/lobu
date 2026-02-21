import { createLogger } from "../logger";

const logger = createLogger("json-utils");

/**
 * Safely parse JSON string
 * Returns null on parse failure instead of throwing
 */
export function safeJsonParse<T = unknown>(
  data: string,
  fallback: T | null = null
): T | null {
  try {
    return JSON.parse(data) as T;
  } catch (error) {
    logger.debug("JSON parse failed", {
      error: error instanceof Error ? error.message : String(error),
      dataPreview: data.substring(0, 100),
    });
    return fallback;
  }
}

/**
 * Safely stringify value to JSON
 * Returns null on stringify failure instead of throwing
 */
export function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.error("JSON stringify failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
