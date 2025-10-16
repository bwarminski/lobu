import { createLogger } from "./logger";

const logger = createLogger("shared");

/**
 * Initialize Sentry with configuration from environment variables
 * Falls back to hardcoded DSN if SENTRY_DSN is not provided
 * Uses dynamic import to avoid module resolution issues in dev mode
 */
export async function initSentry() {
  try {
    const Sentry = await import("@sentry/node");

    const sentryDsn =
      process.env.SENTRY_DSN ||
      "https://078b368139997798ba4d6d23f94dcc7f@o4507291398897664.ingest.us.sentry.io/4509916004220928";

    Sentry.init({
      dsn: sentryDsn,
      sendDefaultPii: true,
      profileSessionSampleRate: 1.0,
      tracesSampleRate: 1.0, // Capture 100% of traces for better visibility
      integrations: [
        Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
        Sentry.postgresIntegration(),
      ],
    });

    logger.info("✅ Sentry monitoring initialized");
  } catch (error) {
    logger.warn(
      "⚠️ Sentry initialization failed (continuing without monitoring):",
      error
    );
  }
}
