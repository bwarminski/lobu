#!/usr/bin/env bun

import type { App } from "@slack/bolt";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("dispatcher");

/**
 * Shared utilities for Slack event handlers
 */

/**
 * Base event handler context
 */
export interface EventHandlerContext {
  app: App;
  event: any;
  client: any;
}

/**
 * Create a generic event handler with error handling and logging
 */
export function createEventHandler(
  eventName: string,
  handler: (context: EventHandlerContext) => Promise<void>
) {
  return async ({ event, client }: { event: any; client: any }) => {
    logger.info(`=== ${eventName.toUpperCase()}_HANDLER TRIGGERED (QUEUE) ===`);

    try {
      await handler({ app: {} as App, event, client });
    } catch (error) {
      logger.error(`Error handling ${eventName}:`, error);
    }
  };
}

/**
 * Setup event handlers for a specific category
 */
export function setupEventHandlers(
  app: App,
  handlers: Record<string, (context: EventHandlerContext) => Promise<void>>
) {
  for (const [eventName, handler] of Object.entries(handlers)) {
    app.event(eventName as any, createEventHandler(eventName, handler));
  }
}
