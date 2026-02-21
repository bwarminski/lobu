import { createLogger } from "@lobu/core";

const logger = createLogger("socket-health-monitor");

const MAX_RECONNECT_ATTEMPTS = 3;

interface SocketHealthConfig {
  /** How often to check for zombie connection (ms) */
  checkIntervalMs: number;
  /** Consider connection stale if no events for this long (ms) */
  staleThresholdMs: number;
  /** Protect active workers from restart */
  protectActiveWorkers: boolean;
}

/**
 * Socket Health Monitor
 *
 * Detects zombie Socket Mode connections by monitoring Socket Mode event activity.
 * Socket Mode emits internal events (heartbeats, keepalives) every ~30-60 seconds
 * even in quiet workspaces. If no events are received for the threshold period,
 * the connection is considered stale/zombie and triggers a reconnection attempt.
 * Only exits the process after MAX_RECONNECT_ATTEMPTS consecutive failures.
 */
export class SocketHealthMonitor {
  private config: SocketHealthConfig;
  private lastEventTimestamp: number;
  private healthCheckInterval?: NodeJS.Timeout;
  private isRunning = false;
  private getActiveWorkerCountFn?: () => number;
  private reconnectFn?: () => Promise<void>;
  private consecutiveStaleChecks = 0;
  private isReconnecting = false;

  constructor(config: SocketHealthConfig) {
    this.config = config;
    this.lastEventTimestamp = Date.now();
  }

  /**
   * Start health monitoring
   */
  start(
    getActiveWorkerCount: () => number,
    reconnectFn?: () => Promise<void>
  ): void {
    if (this.isRunning) {
      logger.warn("Health monitor already running");
      return;
    }

    this.getActiveWorkerCountFn = getActiveWorkerCount;
    this.reconnectFn = reconnectFn;
    this.isRunning = true;
    this.lastEventTimestamp = Date.now(); // Reset on start
    this.consecutiveStaleChecks = 0;

    logger.info("Socket health monitor started", {
      checkIntervalMs: this.config.checkIntervalMs,
      staleThresholdMs: this.config.staleThresholdMs,
      protectActiveWorkers: this.config.protectActiveWorkers,
    });

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    this.isRunning = false;
    logger.info("Socket health monitor stopped");
  }

  /**
   * Record that a Socket Mode event was received
   * Call this on EVERY Socket Mode event (not just messages)
   */
  recordSocketEvent(): void {
    this.lastEventTimestamp = Date.now();
    this.consecutiveStaleChecks = 0;
  }

  /**
   * Perform health check - detect zombie connection
   */
  private performHealthCheck(): void {
    if (!this.isRunning || this.isReconnecting) {
      return;
    }

    const now = Date.now();
    const timeSinceLastEvent = now - this.lastEventTimestamp;
    const activeWorkers = this.getActiveWorkerCountFn?.() || 0;

    // Check if connection is stale
    if (timeSinceLastEvent > this.config.staleThresholdMs) {
      this.consecutiveStaleChecks++;

      logger.warn("🚨 Zombie Socket Mode connection detected!", {
        timeSinceLastEvent,
        staleThresholdMs: this.config.staleThresholdMs,
        activeWorkers,
        attempt: this.consecutiveStaleChecks,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });

      // Check if we should protect active workers
      if (this.config.protectActiveWorkers && activeWorkers > 0) {
        logger.info(
          `Delaying reconnect to protect ${activeWorkers} active worker(s)`
        );
        return;
      }

      // Attempt reconnection if callback is available
      if (
        this.reconnectFn &&
        this.consecutiveStaleChecks <= MAX_RECONNECT_ATTEMPTS
      ) {
        logger.warn(
          `Attempting Socket Mode reconnection (attempt ${this.consecutiveStaleChecks}/${MAX_RECONNECT_ATTEMPTS})`
        );
        this.attemptReconnect();
        return;
      }

      // All reconnect attempts exhausted — exit for container restart
      logger.error(
        `Socket Mode connection stale after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts - exiting for container restart`
      );
      process.exit(0);
    }

    // Log health status periodically for monitoring
    if (timeSinceLastEvent > this.config.staleThresholdMs * 0.5) {
      logger.info("Socket connection health check", {
        timeSinceLastEvent,
        thresholdMs: this.config.staleThresholdMs,
        status: "degraded",
      });
    }
  }

  private attemptReconnect(): void {
    this.isReconnecting = true;
    this.reconnectFn!()
      .then(() => {
        logger.info(
          "Socket Mode reconnection initiated, resetting event timer"
        );
        this.lastEventTimestamp = Date.now();
      })
      .catch((err) => {
        logger.error("Socket Mode reconnection failed", err);
      })
      .finally(() => {
        this.isReconnecting = false;
      });
  }

  /**
   * Get current health status for monitoring/debugging
   */
  getStatus(): {
    isRunning: boolean;
    timeSinceLastEvent: number;
    isStale: boolean;
  } {
    const timeSinceLastEvent = Date.now() - this.lastEventTimestamp;
    return {
      isRunning: this.isRunning,
      timeSinceLastEvent,
      isStale: timeSinceLastEvent > this.config.staleThresholdMs,
    };
  }
}
