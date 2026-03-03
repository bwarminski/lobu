import { useSignal } from "@preact/signals";
import * as api from "../api";
import { useSettings } from "../app";

export function MessageBanners() {
  const ctx = useSettings();

  return (
    <>
      {ctx.successMsg.value && (
        <div class="bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm">
          {ctx.successMsg.value}
        </div>
      )}
      {ctx.errorMsg.value && (
        <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm">
          {ctx.errorMsg.value}
        </div>
      )}
      {ctx.message && (
        <div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-4 text-sm">
          <div class="flex items-start gap-2">
            <span class="text-lg">&#128161;</span>
            <div>{ctx.message}</div>
          </div>
        </div>
      )}
      <PendingApiKeysBanner />
      <PrefillBanner />
    </>
  );
}

function PendingApiKeysBanner() {
  const ctx = useSettings();

  // Derive pending API-key integrations from skills + integrationStatus
  const pending: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const skill of ctx.skills.value) {
    if (!skill.enabled || !skill.integrations) continue;
    for (const ig of skill.integrations) {
      if (ig.authType !== "api-key" || seen.has(ig.id)) continue;
      seen.add(ig.id);
      const status = ctx.integrationStatus.value[ig.id];
      if (!status?.connected) {
        pending.push({ id: ig.id, label: ig.label || ig.id });
      }
    }
  }

  if (pending.length === 0) return null;

  return (
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#128273;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">API key required</h3>
          <p class="text-xs text-amber-700 mt-0.5">
            Enter your API key to activate{" "}
            {pending.length === 1 ? "this integration" : "these integrations"}.
          </p>
        </div>
      </div>
      <div class="space-y-2">
        {pending.map((integration) => (
          <PendingApiKeyRow key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  );
}

function PendingApiKeyRow({
  integration,
}: {
  integration: { id: string; label: string };
}) {
  const ctx = useSettings();
  const keyValue = useSignal("");
  const saving = useSignal(false);
  const error = useSignal("");

  async function handleSave() {
    const key = keyValue.value.trim();
    if (!key) return;
    saving.value = true;
    error.value = "";
    try {
      await api.saveIntegrationApiKey(ctx.agentId, integration.id, key);
      ctx.integrationStatus.value = {
        ...ctx.integrationStatus.value,
        [integration.id]: {
          connected: true,
          accounts: [{ accountId: "default", grantedScopes: [] }],
          availableScopes:
            ctx.integrationStatus.value[integration.id]?.availableScopes || [],
        },
      };
      keyValue.value = "";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving.value = false;
    }
  }

  return (
    <div class="space-y-1">
      <p class="text-xs font-medium text-amber-900">{integration.label}</p>
      <div class="flex items-center gap-1.5">
        <input
          type="password"
          value={keyValue.value}
          onInput={(e) => {
            keyValue.value = (e.target as HTMLInputElement).value;
          }}
          placeholder="Paste API key..."
          class="flex-1 px-2 py-1.5 border border-amber-200 rounded text-xs bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-200 outline-none"
        />
        <button
          type="button"
          disabled={saving.value || !keyValue.value.trim()}
          onClick={handleSave}
          class="px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {saving.value ? "Saving..." : "Save"}
        </button>
      </div>
      {error.value && <p class="text-xs text-red-600">{error.value}</p>}
    </div>
  );
}

function PrefillBanner() {
  const ctx = useSettings();

  const hasPrefills =
    ctx.prefillGrants.value.length > 0 ||
    ctx.prefillNixPackages.value.length > 0 ||
    ctx.prefillEnvVars.value.length > 0 ||
    ctx.prefillSkills.value.length > 0 ||
    ctx.prefillMcpServers.value.length > 0;

  if (!hasPrefills || ctx.prefillBannerDismissed.value) return null;

  async function handleApproveAll() {
    ctx.approvingPrefills.value = true;
    ctx.errorMsg.value = "";
    ctx.successMsg.value = "";
    try {
      // 1. Add grants to local state
      for (const d of ctx.prefillGrants.value) {
        if (!ctx.permissionGrants.value.some((g) => g.pattern === d)) {
          ctx.permissionGrants.value = [
            ...ctx.permissionGrants.value,
            { pattern: d, expiresAt: null },
          ];
        }
      }

      // 2. Merge nix packages locally
      if (ctx.prefillNixPackages.value.length > 0) {
        const merged = [...ctx.nixPackages.value];
        for (const pkg of ctx.prefillNixPackages.value) {
          const name = (pkg || "").trim();
          if (name && !merged.includes(name)) merged.push(name);
        }
        ctx.nixPackages.value = merged;
      }

      // 3. Fetch and add prefill skills locally
      const failures: string[] = [];
      for (const skill of ctx.prefillSkills.value) {
        if (ctx.skills.value.some((s) => s.repo === skill.repo)) continue;
        try {
          const fetched = await api.fetchSkillContent(skill.repo);
          ctx.skills.value = [
            ...ctx.skills.value,
            {
              repo: fetched.repo,
              name: fetched.name || skill.name || "",
              description: fetched.description || skill.description || "",
              enabled: true,
              content: fetched.content,
              contentFetchedAt: fetched.fetchedAt,
            },
          ];
        } catch {
          failures.push(skill.name || skill.repo);
        }
      }

      // 4. Add prefill MCPs locally
      for (const mcp of ctx.prefillMcpServers.value) {
        if (ctx.mcpServers.value[mcp.id]) continue;
        const mcpConfig: Record<string, unknown> = {};
        if (mcp.url) mcpConfig.url = mcp.url;
        if (mcp.type) mcpConfig.type = mcp.type;
        if (mcp.command) mcpConfig.command = mcp.command;
        if (mcp.args) mcpConfig.args = mcp.args;
        if (mcp.name) mcpConfig.description = mcp.name;
        ctx.mcpServers.value = { ...ctx.mcpServers.value, [mcp.id]: mcpConfig };
      }

      // 5. Dismiss + show result
      ctx.prefillBannerDismissed.value = true;
      ctx.errorMsg.value = "";
      if (failures.length > 0) {
        ctx.errorMsg.value = `Some items failed to add: ${failures.join(", ")}`;
      }
      ctx.successMsg.value = "Changes accepted! Click Save Settings to apply.";
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: unknown) {
      ctx.errorMsg.value =
        "Error approving changes: " +
        (e instanceof Error ? e.message : "Unknown error");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      ctx.approvingPrefills.value = false;
    }
  }

  function handleDismiss() {
    ctx.prefillBannerDismissed.value = true;
    const u = new URL(window.location.href);
    u.searchParams.set("dismissed", "1");
    window.history.replaceState({}, "", u.toString());
  }

  return (
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#9888;&#65039;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">
            Pending changes from your agent
          </h3>
          <p class="text-xs text-amber-700 mt-0.5">
            Review and approve the requested configuration changes.
          </p>
        </div>
      </div>
      <div class="space-y-2 mb-3">
        {ctx.prefillGrants.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#127760; Network Access Domains
            </p>
            <div class="flex flex-wrap gap-1">
              {ctx.prefillGrants.value.map((d) => (
                <span
                  key={d}
                  class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}
        {ctx.prefillNixPackages.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#128230; System Packages
            </p>
            <div class="flex flex-wrap gap-1">
              {ctx.prefillNixPackages.value.map((p) => (
                <span
                  key={p}
                  class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
        {ctx.prefillEnvVars.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#128203; Secrets
            </p>
            <div class="flex flex-wrap gap-1">
              {ctx.prefillEnvVars.value.map((v) => (
                <span
                  key={v}
                  class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900"
                >
                  {v}
                </span>
              ))}
            </div>
            <p class="text-xs text-amber-700 mt-1">
              You'll need to fill in values after approving.
            </p>
          </div>
        )}
        {ctx.prefillSkills.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#9889; Skills
            </p>
            <div class="space-y-1">
              {ctx.prefillSkills.value.map((s) => (
                <div key={s.repo} class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900">
                    {s.name || s.repo}
                  </span>
                  <span class="text-xs text-amber-600 font-mono">{s.repo}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {ctx.prefillMcpServers.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#128268; MCP Servers
            </p>
            <div class="space-y-1">
              {ctx.prefillMcpServers.value.map((m) => (
                <div key={m.id} class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900">
                    {m.name || m.id}
                  </span>
                  <span class="text-xs text-amber-600 font-mono">
                    {m.url || ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          onClick={handleApproveAll}
          disabled={ctx.approvingPrefills.value}
          class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all disabled:opacity-60"
        >
          {ctx.approvingPrefills.value ? "Approving..." : "Approve All"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          class="px-4 py-2 text-xs font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition-all"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
