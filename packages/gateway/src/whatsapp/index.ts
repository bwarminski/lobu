/**
 * WhatsApp platform module exports.
 */

export {
  buildWhatsAppConfig,
  DEFAULT_WHATSAPP_CONFIG,
  type WhatsAppConfig,
} from "./config";
export { BaileysClient } from "./connection/baileys-client";
export { WhatsAppMessageHandler } from "./events/message-handler";
export { WhatsAppInteractionRenderer } from "./interactions";
export {
  type AgentOptions,
  WhatsAppPlatform,
  type WhatsAppPlatformConfig,
} from "./platform";
export { WhatsAppResponseRenderer } from "./response-renderer";
export { runWhatsAppSetup } from "./setup";
export * from "./types";
