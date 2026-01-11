/**
 * Reconnection logic with exponential backoff and jitter.
 * Adapted from clawdbot/src/web/reconnect.ts
 */

import type { ReconnectPolicy } from "../types";

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 5,
};

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val));

/**
 * Normalize and validate reconnect policy values.
 */
export function normalizeReconnectPolicy(
  overrides?: Partial<ReconnectPolicy>
): ReconnectPolicy {
  const merged = {
    ...DEFAULT_RECONNECT_POLICY,
    ...overrides,
  };

  merged.initialMs = Math.max(250, merged.initialMs);
  merged.maxMs = Math.max(merged.initialMs, merged.maxMs);
  merged.factor = clamp(merged.factor, 1.1, 10);
  merged.jitter = clamp(merged.jitter, 0, 1);
  merged.maxAttempts = Math.max(0, Math.floor(merged.maxAttempts));

  return merged;
}

/**
 * Compute backoff delay with exponential growth and jitter.
 */
export function computeBackoff(
  policy: ReconnectPolicy,
  attempt: number
): number {
  const base = policy.initialMs * policy.factor ** Math.max(attempt - 1, 0);
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitter));
}

/**
 * Sleep with abort signal support.
 */
export function sleepWithAbort(
  ms: number,
  abortSignal?: AbortSignal
): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
    };

    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Reconnection manager that handles automatic reconnection with backoff.
 */
export class ReconnectionManager {
  private attempts: number = 0;
  private policy: ReconnectPolicy;
  private abortController: AbortController | null = null;

  constructor(policy?: Partial<ReconnectPolicy>) {
    this.policy = normalizeReconnectPolicy(policy);
  }

  /**
   * Get current attempt count.
   */
  getAttempts(): number {
    return this.attempts;
  }

  /**
   * Check if we should attempt reconnection.
   */
  shouldReconnect(): boolean {
    return this.attempts < this.policy.maxAttempts;
  }

  /**
   * Reset attempt counter (call after successful connection).
   */
  reset(): void {
    this.attempts = 0;
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Abort any pending reconnection.
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Attempt reconnection with backoff delay.
   * Returns true if reconnection should be attempted, false if max attempts reached.
   */
  async waitForNextAttempt(): Promise<boolean> {
    this.attempts++;

    if (this.attempts > this.policy.maxAttempts) {
      return false;
    }

    const delay = computeBackoff(this.policy, this.attempts);
    this.abortController = new AbortController();

    try {
      await sleepWithAbort(delay, this.abortController.signal);
      return true;
    } catch {
      // Aborted
      return false;
    }
  }

  /**
   * Get delay for current attempt (for logging).
   */
  getCurrentDelay(): number {
    return computeBackoff(this.policy, this.attempts + 1);
  }
}
