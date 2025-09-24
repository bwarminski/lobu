import { startProcessManagerServer } from "../mcp/process-manager-server.js";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("worker");

export interface ProcessManagerInstance {
  port: number;
  server: any;
  httpServer: any;
  close: () => Promise<void>;
  stop: () => Promise<void>;
}

let processManagerInstance: ProcessManagerInstance | null = null;

/**
 * Start the process manager HTTP server integrated with the worker process
 */
export async function startProcessManager(): Promise<ProcessManagerInstance> {
  if (processManagerInstance) {
    logger.info(
      "Process manager already running on port",
      processManagerInstance.port
    );
    return processManagerInstance;
  }

  try {
    logger.info("🔧 Starting integrated process manager HTTP server...");
    const { port, server, httpServer, close } =
      await startProcessManagerServer();

    processManagerInstance = {
      port,
      server,
      httpServer,
      close,
      stop: async () => {
        if (processManagerInstance) {
          logger.info("🛑 Stopping process manager HTTP server...");
          await processManagerInstance.close();
          processManagerInstance = null;
        }
      },
    };

    logger.info(`✅ Process manager HTTP server started on port ${port}`);
    return processManagerInstance;
  } catch (error) {
    logger.error("❌ Failed to start process manager HTTP server:", error);
    throw error;
  }
}

/**
 * Stop the process manager server
 */
export async function stopProcessManager(): Promise<void> {
  if (processManagerInstance) {
    await processManagerInstance.stop();
  }
}

/**
 * Get the current process manager instance
 */
export function getProcessManagerInstance(): ProcessManagerInstance | null {
  return processManagerInstance;
}
