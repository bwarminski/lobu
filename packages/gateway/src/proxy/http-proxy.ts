import * as http from "node:http";
import * as net from "node:net";
import { URL } from "node:url";
import { createLogger } from "@peerbot/core";
import {
  isUnrestrictedMode,
  loadAllowedDomains,
  loadDisallowedDomains,
} from "../config/network-allowlist";

const logger = createLogger("http-proxy");

/**
 * Check if a hostname matches any domain patterns
 * Supports exact matches and wildcard patterns (.example.com matches *.example.com)
 */
function matchesDomainPattern(hostname: string, patterns: string[]): boolean {
  const lowerHostname = hostname.toLowerCase();

  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.startsWith(".")) {
      // Wildcard pattern: .example.com matches *.example.com
      const domain = lowerPattern.substring(1);
      if (lowerHostname === domain || lowerHostname.endsWith(`.${domain}`)) {
        return true;
      }
    } else if (lowerPattern === lowerHostname) {
      // Exact match
      return true;
    }
  }

  return false;
}

/**
 * Check if a hostname is allowed based on allowlist/blocklist configuration
 */
function isHostnameAllowed(
  hostname: string,
  allowedDomains: string[],
  disallowedDomains: string[]
): boolean {
  // Unrestricted mode - allow all except explicitly disallowed
  if (isUnrestrictedMode(allowedDomains)) {
    if (disallowedDomains.length === 0) {
      return true; // No blocklist, allow all
    }
    return !matchesDomainPattern(hostname, disallowedDomains);
  }

  // Complete isolation mode - deny all
  if (allowedDomains.length === 0) {
    return false;
  }

  // Allowlist mode - check if allowed
  const isAllowed = matchesDomainPattern(hostname, allowedDomains);

  // Even if allowed, check blocklist
  if (isAllowed && disallowedDomains.length > 0) {
    return !matchesDomainPattern(hostname, disallowedDomains);
  }

  return isAllowed;
}

/**
 * Extract hostname from CONNECT request
 */
function extractConnectHostname(url: string): string | null {
  // CONNECT requests are in format: "host:port"
  const match = url.match(/^([^:]+):\d+$/);
  return match?.[1] ? match[1] : null;
}

/**
 * Handle HTTPS CONNECT tunneling
 * Establishes TCP tunnel between client and target for encrypted traffic
 */
function handleConnect(
  req: http.IncomingMessage,
  clientSocket: import("stream").Duplex,
  head: Buffer,
  allowedDomains: string[],
  disallowedDomains: string[]
): void {
  const url = req.url || "";
  const hostname = extractConnectHostname(url);

  if (!hostname) {
    logger.warn(`Invalid CONNECT request: ${url}`);
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.end();
    return;
  }

  // Check if hostname is allowed
  if (!isHostnameAllowed(hostname, allowedDomains, disallowedDomains)) {
    logger.warn(`Blocked CONNECT to ${hostname} (not in allowlist)`);
    try {
      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nDomain not allowed by proxy policy\r\n"
      );
      clientSocket.end();
    } catch {
      // Client may have already disconnected
    }
    return;
  }

  logger.debug(`Allowing CONNECT to ${hostname}`);

  // Parse host and port
  const [host, portStr] = url.split(":");
  const port = portStr ? parseInt(portStr, 10) || 443 : 443;

  if (!host) {
    logger.warn(`Invalid CONNECT host: ${url}`);
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.end();
    return;
  }

  // Establish connection to target
  const targetSocket = net.connect(port, host, () => {
    // Send success response to client
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    // Pipe the connection bidirectionally
    targetSocket.write(head);
    targetSocket.pipe(clientSocket);
    clientSocket.pipe(targetSocket);
  });

  targetSocket.on("error", (err) => {
    logger.debug(`Target connection error for ${hostname}: ${err.message}`);
    try {
      clientSocket.end();
    } catch {
      // Ignore errors when closing already-closed socket
    }
  });

  clientSocket.on("error", (err) => {
    // ECONNRESET is common when clients drop connections - don't log as error
    if ((err as NodeJS.ErrnoException).code === "ECONNRESET") {
      logger.debug(`Client disconnected for ${hostname} (ECONNRESET)`);
    } else {
      logger.debug(`Client connection error for ${hostname}: ${err.message}`);
    }
    try {
      targetSocket.end();
    } catch {
      // Ignore errors when closing already-closed socket
    }
  });

  // Handle close events to clean up
  targetSocket.on("close", () => {
    try {
      clientSocket.end();
    } catch {
      // Ignore
    }
  });

  clientSocket.on("close", () => {
    try {
      targetSocket.end();
    } catch {
      // Ignore
    }
  });
}

/**
 * Handle regular HTTP proxy requests (GET, POST, etc.)
 */
function handleProxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedDomains: string[],
  disallowedDomains: string[]
): void {
  const targetUrl = req.url;

  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request: No URL provided\n");
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request: Invalid URL\n");
    return;
  }

  const hostname = parsedUrl.hostname;

  // Check if hostname is allowed
  if (!isHostnameAllowed(hostname, allowedDomains, disallowedDomains)) {
    logger.warn(`Blocked request to ${hostname} (not in allowlist)`);
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Domain not allowed by proxy policy\n");
    return;
  }

  logger.debug(`Proxying ${req.method} ${hostname}${parsedUrl.pathname}`);

  // Forward the request
  const options: http.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Forward response headers
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    // Stream response body
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    logger.error(`Proxy request error for ${hostname}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway: Could not reach target server\n");
    } else {
      res.end();
    }
  });

  // Stream request body
  req.pipe(proxyReq);
}

/**
 * Start HTTP proxy server
 */
export function startHttpProxy(port: number = 8118): http.Server {
  const allowedDomains = loadAllowedDomains();
  const disallowedDomains = loadDisallowedDomains();

  const server = http.createServer((req, res) => {
    handleProxyRequest(req, res, allowedDomains, disallowedDomains);
  });

  // Handle CONNECT method for HTTPS tunneling
  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket, head, allowedDomains, disallowedDomains);
  });

  server.listen(port, "0.0.0.0", () => {
    let mode: string;
    if (isUnrestrictedMode(allowedDomains)) {
      mode = "unrestricted";
    } else if (allowedDomains.length > 0) {
      mode = "allowlist";
    } else {
      mode = "complete-isolation";
    }

    logger.info(
      `🔒 HTTP proxy started on port ${port} (mode=${mode}, allowed=${allowedDomains.length}, disallowed=${disallowedDomains.length})`
    );
  });

  server.on("error", (err) => {
    logger.error("HTTP proxy server error:", err);
  });

  return server;
}

/**
 * Stop HTTP proxy server
 */
export function stopHttpProxy(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.error("Error stopping HTTP proxy:", err);
        reject(err);
      } else {
        logger.info("HTTP proxy stopped");
        resolve();
      }
    });
  });
}
