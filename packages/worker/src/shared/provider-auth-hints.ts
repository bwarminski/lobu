const PROVIDER_API_KEY_ENV_VARS: Record<string, string> = {
  "openai-codex": "OPENAI_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

function sanitizeProviderToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getApiKeyEnvVarForProvider(providerName: string): string {
  const normalizedProvider = providerName.trim().toLowerCase();
  const mapped = PROVIDER_API_KEY_ENV_VARS[normalizedProvider];
  if (mapped) {
    return mapped;
  }

  const sanitized = sanitizeProviderToken(providerName);
  if (!sanitized || sanitized === "provider") {
    return "API_KEY";
  }

  return `${sanitized.toUpperCase()}_API_KEY`;
}

export function getProviderAuthHintFromError(
  errorMessage: string
): { providerName: string; envVar: string } | null {
  const needsAuthSetup = /No API key found|Authentication failed/i.test(
    errorMessage
  );
  if (!needsAuthSetup) {
    return null;
  }

  const providerMatch = errorMessage.match(
    /(?:No API key found for|Authentication failed for)\s+([A-Za-z0-9._-]+)/i
  );
  const providerName = providerMatch?.[1]?.toLowerCase() || "provider";

  return {
    providerName,
    envVar: getApiKeyEnvVarForProvider(providerName),
  };
}
