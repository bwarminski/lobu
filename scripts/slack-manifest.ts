import { readFile } from "node:fs/promises";

type SlackApiResponse =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; [key: string]: unknown };

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }
  return out;
}

async function loadEnv(): Promise<void> {
  const dotenvPath = process.env.DOTENV_PATH || ".env";
  try {
    const contents = await readFile(dotenvPath, "utf8");
    const env = parseDotenv(contents);
    for (const [k, v] of Object.entries(env)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // It's fine if .env doesn't exist (CI, or user exports env vars directly).
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function patchManifestGatewayUrls(
  manifest: Record<string, unknown>,
  publicGatewayUrl: string
): void {
  const base = normalizeBaseUrl(publicGatewayUrl);
  const eventsUrl = `${base}/slack/events`;

  const settings = manifest.settings as Record<string, unknown> | undefined;
  if (settings) {
    const eventSubs = settings.event_subscriptions as
      | Record<string, unknown>
      | undefined;
    if (eventSubs) eventSubs.request_url = eventsUrl;

    const interactivity = settings.interactivity as
      | Record<string, unknown>
      | undefined;
    if (interactivity) interactivity.request_url = eventsUrl;
  }

  const features = manifest.features as Record<string, unknown> | undefined;
  if (features) {
    const slashCommands = features.slash_commands as unknown;
    if (Array.isArray(slashCommands)) {
      for (const cmd of slashCommands) {
        if (cmd && typeof cmd === "object") {
          (cmd as Record<string, unknown>).url = eventsUrl;
        }
      }
    }
  }
}

async function slackApiCall(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as SlackApiResponse;
}

async function main(): Promise<void> {
  await loadEnv();

  const cmd = process.argv[2] || "print";
  const manifestPath =
    process.env.SLACK_MANIFEST_PATH || "slack-app-manifest.community.json";

  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  const publicGatewayUrl = process.env.PUBLIC_GATEWAY_URL;
  if (publicGatewayUrl) {
    patchManifestGatewayUrls(manifest, publicGatewayUrl);
  }

  if (cmd === "print") {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  const token = requireEnv("SLACK_CONFIG_TOKEN");

  if (cmd === "validate") {
    const result = await slackApiCall("apps.manifest.validate", token, {
      manifest,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === "update") {
    const appId = requireEnv("SLACK_APP_ID");
    const result = await slackApiCall("apps.manifest.update", token, {
      app_id: appId,
      manifest,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
    return;
  }

  throw new Error(`Unknown command: ${cmd} (expected: print|validate|update)`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.stderr.write(
    "Usage: bun run scripts/slack-manifest.ts print|validate|update\n"
  );
  process.stderr.write("Env: SLACK_CONFIG_TOKEN, SLACK_APP_ID (for update)\n");
  process.stderr.write(
    "Optional env: SLACK_MANIFEST_PATH, PUBLIC_GATEWAY_URL, DOTENV_PATH\n"
  );
  process.exit(1);
});
