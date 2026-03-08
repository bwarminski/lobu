// ABOUTME: Builds and executes worker-authenticated HTTP proxy probe requests.
// ABOUTME: Provides a CLI for compose integration tests to assert gateway proxy behavior.
import { spawnSync } from "node:child_process";

export interface ProxyProbeInput {
  gatewayHost: string;
  deploymentName: string;
  workerToken: string;
  destination: string;
}

export interface ProxyRequestSpec {
  proxyUrl: string;
  targetUrl: string;
}

export function buildProxyRequest(input: ProxyProbeInput): ProxyRequestSpec {
  return {
    proxyUrl: `http://${encodeURIComponent(input.deploymentName)}:${encodeURIComponent(input.workerToken)}@${input.gatewayHost}:8118`,
    targetUrl: input.destination,
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument: --${key}`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const gatewayHost = args["gateway-host"] || "localhost";
  const deploymentName = args["deployment-name"];
  const workerToken = args["worker-token"];
  const destination = args.destination;
  const method = (args.method || "GET").toUpperCase();
  const timeoutSeconds = Number.parseInt(args.timeout || "30", 10);
  const printOnly = args["print-only"] === "true";

  if (!deploymentName || !workerToken || !destination) {
    throw new Error(
      "Required args: --deployment-name <name> --worker-token <token> --destination <url>"
    );
  }

  const request = buildProxyRequest({
    gatewayHost,
    deploymentName,
    workerToken,
    destination,
  });

  if (printOnly) {
    console.log(JSON.stringify({ request }, null, 2));
    return;
  }

  const curl = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--location",
      "--request",
      method,
      "--proxy",
      request.proxyUrl,
      "--max-time",
      String(timeoutSeconds),
      "--write-out",
      "\n%{http_code}",
      request.targetUrl,
    ],
    { encoding: "utf8" }
  );

  if (curl.error) {
    throw curl.error;
  }

  const stdout = curl.stdout || "";
  const split = stdout.lastIndexOf("\n");
  const body = split >= 0 ? stdout.slice(0, split) : stdout;
  const statusText = split >= 0 ? stdout.slice(split + 1).trim() : "";
  const status = Number.parseInt(statusText, 10);

  const payload = {
    request,
    status: Number.isNaN(status) ? 0 : status,
    body,
    stderr: curl.stderr || "",
    exitCode: curl.status ?? 1,
  };

  console.log(JSON.stringify(payload, null, 2));

  if ((curl.status ?? 1) !== 0) {
    process.exit(curl.status ?? 1);
  }
}

if (import.meta.main) {
  main();
}
