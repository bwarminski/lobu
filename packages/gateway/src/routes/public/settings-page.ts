/**
 * Settings Page HTML Templates (Alpine.js + Pre-compiled Tailwind CSS)
 */

import type { ModelOption } from "@lobu/core";
import type { AgentMetadata } from "../../auth/agent-metadata-store";
import type { AgentSettings } from "../../auth/settings";
import type { SettingsTokenPayload } from "../../auth/settings/token-service";
import { platformRegistry } from "../../platform";
import { settingsPageCSS } from "./settings-page-styles";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format userId for display - handles phone numbers and platform-specific IDs
 */
function formatUserId(userId: string): string {
  if (userId.startsWith("+")) {
    return userId;
  }
  if (userId.includes("@")) {
    const parts = userId.split("@");
    const id = parts[0] || "";
    const domain = parts[1] || "";
    if (domain === "lid") {
      return `ID: ${id.slice(0, 8)}...`;
    }
    if (domain === "s.whatsapp.net") {
      return `+${id}`;
    }
    return userId;
  }
  return userId;
}

/**
 * Get platform display info from the registry, with fallback for unknown platforms
 */
function getPlatformDisplay(platform: string): { icon: string; name: string } {
  const adapter = platformRegistry.get(platform);
  if (adapter?.getDisplayInfo) {
    const info = adapter.getDisplayInfo();
    const icon = info.icon.includes('class="')
      ? info.icon.replace('class="', 'class="w-4 h-4 inline-block ')
      : info.icon.replace("<svg", '<svg class="w-4 h-4 inline-block"');
    return { icon, name: info.name };
  }

  return {
    icon: '<svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
    name: platform || "API",
  };
}

export interface ProviderMeta {
  id: string;
  name: string;
  iconUrl: string;
  authType: "oauth" | "device-code" | "api-key";
  supportedAuthTypes: ("oauth" | "device-code" | "api-key")[];
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
  catalogDescription?: string;
}

export interface SettingsPageOptions {
  githubAppConfigured: boolean;
  githubAppInstallUrl?: string;
  githubOAuthConfigured?: boolean;
  providers?: ProviderMeta[];
  catalogProviders?: ProviderMeta[];
  providerModelOptions?: Record<string, ModelOption[]>;
  /** Show agent switcher in settings page (channel-based tokens) */
  showSwitcher?: boolean;
  /** User's agents for the switcher */
  agents?: (AgentMetadata & { channelCount: number })[];
  /** Agent name from metadata */
  agentName?: string;
  /** Agent description from metadata */
  agentDescription?: string;
  /** Whether the token has a channelId (for post-delete behavior) */
  hasChannelId?: boolean;
}

export function renderSettingsPage(
  payload: SettingsTokenPayload,
  settings: AgentSettings | null,
  token: string,
  options?: SettingsPageOptions
): string {
  const s: Partial<AgentSettings> = settings || {};
  const githubAppConfigured = options?.githubAppConfigured ?? false;
  const githubAppInstallUrl = options?.githubAppInstallUrl ?? "";
  const githubOAuthConfigured = options?.githubOAuthConfigured ?? false;
  // Installed providers (already resolved in order by settings.ts)
  const providers: ProviderMeta[] = options?.providers ?? [];

  // Catalog providers (available but not installed)
  const catalogProviders: ProviderMeta[] = options?.catalogProviders ?? [];

  const providerModelOptions: Record<string, ModelOption[]> =
    options?.providerModelOptions || {};

  const providerOrder = providers.map((p) => p.id);

  const envVarsValue = (() => {
    const existingEnvVars = s.envVars || {};
    const prefillKeys = payload.prefillEnvVars || [];
    const allKeys = new Set([...Object.keys(existingEnvVars), ...prefillKeys]);
    return Array.from(allKeys)
      .map((k) => `${k}=${existingEnvVars[k] || ""}`)
      .join("\n");
  })();

  const showSwitcher = options?.showSwitcher ?? false;
  const agents = options?.agents ?? [];
  const agentName = options?.agentName ?? "";
  const agentDescription = options?.agentDescription ?? "";
  const hasChannelId = options?.hasChannelId ?? false;

  const initialState = {
    token,
    agentId: payload.agentId,
    githubOAuthConfigured,
    githubAppConfigured,
    githubAppInstallUrl,
    PROVIDERS: Object.fromEntries(
      providers.map((p) => [
        p.id,
        {
          name: p.name,
          authType: p.authType,
          supportedAuthTypes: p.supportedAuthTypes,
          apiKeyInstructions: p.apiKeyInstructions,
          apiKeyPlaceholder: p.apiKeyPlaceholder,
        },
      ])
    ),
    providerOrder,
    providerModels: providerModelOptions,
    catalogProviders: catalogProviders.map((p) => ({
      id: p.id,
      name: p.name,
      iconUrl: p.iconUrl,
      authType: p.authType,
      supportedAuthTypes: p.supportedAuthTypes,
      apiKeyInstructions: p.apiKeyInstructions,
      apiKeyPlaceholder: p.apiKeyPlaceholder,
    })),
    initialSkills: s.skillsConfig?.skills || [],
    initialMcpServers: s.mcpServers || {},
    prefillSkills: payload.prefillSkills || [],
    prefillMcpServers: payload.prefillMcpServers || [],
    prefillAllowedDomains: payload.prefillAllowedDomains || [],
    prefillNixPackages: payload.prefillNixPackages || [],
    prefillEnvVars: payload.prefillEnvVars || [],
    agentName,
    agentDescription,
    hasChannelId,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Settings - Lobu</title>
  <style>${settingsPageCSS}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4" x-data="settingsApp()" x-cloak>
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div class="mb-5" x-data="{ ${showSwitcher ? "switcherOpen: false, switching: false, creatingInSwitcher: false, switcherNewName: '', " : ""}editingIdentity: false, showDeleteConfirm: false, deleteConfirmText: '', deleting: false }">
      <div class="text-center mb-3">
        <div class="text-4xl mb-1">&#129438;</div>
        <div class="relative inline-block" x-show="!editingIdentity">
${
  showSwitcher
    ? `          <button type="button" @click="switcherOpen = !switcherOpen" class="inline-flex items-center gap-1.5 text-xl font-bold text-slate-900 hover:text-slate-700 transition-colors" title="${escapeHtml(payload.agentId || "")}">
            <span x-text="agentName || 'Agent Settings'"></span>
            <svg class="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
          </button>
          <div x-show="switcherOpen" @click.away="switcherOpen = false" class="absolute left-1/2 -translate-x-1/2 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20">
            <div class="max-h-48 overflow-y-auto">
${agents
  .map(
    (agent) => `
              <div class="w-full flex items-center justify-between px-3 py-2 text-left ${agent.agentId !== payload.agentId ? "hover:bg-slate-50 cursor-pointer" : "bg-slate-50"} transition-colors border-b border-slate-100 last:border-b-0"${agent.agentId !== payload.agentId ? ` @click="switching = true; switchAgent('${escapeHtml(agent.agentId)}')"` : ""}>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-800" title="${escapeHtml(agent.agentId)}">${escapeHtml(agent.name)}${agent.isWorkspaceAgent ? ' <span class="text-xs text-slate-500">(workspace)</span>' : ""}</p>
                </div>
                ${
                  agent.agentId === payload.agentId
                    ? `<div class="flex items-center gap-1 flex-shrink-0 ml-2">
                  <span class="text-xs text-slate-600">Current</span>
                  <button type="button" @click.stop="switcherOpen = false; editingIdentity = true" class="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Edit">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                  </button>
                  <button type="button" @click.stop="switcherOpen = false; showDeleteConfirm = true" class="p-1 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>`
                    : ""
                }
              </div>`
  )
  .join("")}
            </div>
            <!-- Create New Agent -->
            <div class="border-t border-slate-200">
              <template x-if="!creatingInSwitcher">
                <button type="button" @click.stop="creatingInSwitcher = true"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors text-slate-600">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                  <span class="text-sm font-medium">Create new agent</span>
                </button>
              </template>
              <template x-if="creatingInSwitcher">
                <div class="px-3 py-2 space-y-2" @click.stop>
                  <input type="text" x-model="switcherNewName" placeholder="Agent name" maxlength="100"
                    class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                    @keydown.enter.prevent="if (switcherNewName.trim()) createAgentFromSwitcher(switcherNewName)">
                  <div class="flex gap-2">
                    <button type="button" @click="creatingInSwitcher = false; switcherNewName = ''"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
                    <button type="button" @click="createAgentFromSwitcher(switcherNewName)" :disabled="!switcherNewName.trim() || switching"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
                      x-text="switching ? 'Creating...' : 'Create'"></button>
                  </div>
                </div>
              </template>
            </div>
          </div>`
    : `          <div class="inline-flex items-center gap-2">
            <h1 class="text-xl font-bold text-slate-900" x-text="agentName || 'Agent Settings'" title="${escapeHtml(payload.agentId || "")}"></h1>
            <button type="button" @click="editingIdentity = true" class="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Edit">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button type="button" @click="showDeleteConfirm = true" class="p-1 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>`
}
        </div>
        <p x-show="!editingIdentity && agentDescription" class="text-xs text-gray-500 mt-0.5" x-text="agentDescription"></p>
        <p class="text-xs text-gray-500 mt-1">${getPlatformDisplay(payload.platform).icon} ${escapeHtml(formatUserId(payload.userId))}</p>
      </div>

      <!-- Inline identity edit -->
      <div x-show="editingIdentity" x-transition class="space-y-2 mb-3">
        <input type="text" x-model="agentName" maxlength="100" placeholder="Agent name"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        <input type="text" x-model="agentDescription" maxlength="200" placeholder="Short description"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        <div class="flex gap-2 justify-center">
          <button type="button" @click="editingIdentity = false; agentName = _initialAgentName; agentDescription = _initialAgentDescription"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
          <button type="button" @click="await saveIdentity(); editingIdentity = false"
            :disabled="savingIdentity || (agentName === _initialAgentName && agentDescription === _initialAgentDescription)"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
            x-text="savingIdentity ? 'Saving...' : 'Save'"></button>
        </div>
      </div>

      <!-- Delete confirmation -->
      <div x-show="showDeleteConfirm" x-transition class="mt-2 space-y-2">
        <p class="text-xs text-gray-600 text-center">Type <strong class="font-mono">${escapeHtml(payload.agentId || "")}</strong> to confirm deletion:</p>
        <input type="text" x-model="deleteConfirmText" placeholder="${escapeHtml(payload.agentId || "")}"
          class="w-full px-3 py-2 border border-red-200 rounded-lg text-xs font-mono focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none"
          @keydown.enter.prevent="if (deleteConfirmText === '${escapeHtml(payload.agentId || "")}') deleteAgent()">
        <div class="flex gap-2">
          <button type="button" @click="showDeleteConfirm = false; deleteConfirmText = ''"
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
          <button type="button" @click="deleteAgent()" :disabled="deleteConfirmText !== '${escapeHtml(payload.agentId || "")}' || deleting"
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60"
            x-text="deleting ? 'Deleting...' : 'Delete'"></button>
        </div>
      </div>
    </div>

    <div x-show="successMsg" x-transition class="bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm" x-text="successMsg"></div>
    <div x-show="errorMsg" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm" x-text="errorMsg"></div>
    ${
      payload.message
        ? `<div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-4 text-sm">
      <div class="flex items-start gap-2">
        <span class="text-lg">&#128161;</span>
        <div>${escapeHtml(payload.message)}</div>
      </div>
    </div>`
        : ""
    }
    <!-- Prefill Confirmation Banner -->
    <div x-show="hasPrefills && !prefillBannerDismissed" x-transition class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#9888;&#65039;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">Pending changes from your agent</h3>
          <p class="text-xs text-amber-700 mt-0.5">Review and approve the requested configuration changes.</p>
        </div>
      </div>
      <div class="space-y-2 mb-3">
        <template x-if="prefillAllowedDomains.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#127760; Network Access Domains</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="d in prefillAllowedDomains" :key="d">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="d"></span>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillNixPackages.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128230; System Packages</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="p in prefillNixPackages" :key="p">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="p"></span>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillEnvVars.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128203; Environment Variables</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="v in prefillEnvVars" :key="v">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="v"></span>
              </template>
            </div>
            <p class="text-xs text-amber-700 mt-1">You'll need to fill in values after approving.</p>
          </div>
        </template>
        <template x-if="prefillSkills.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#9889; Skills</p>
            <div class="space-y-1">
              <template x-for="s in prefillSkills" :key="s.repo">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900" x-text="s.name || s.repo"></span>
                  <span class="text-xs text-amber-600 font-mono" x-text="s.repo"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillMcpServers.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128268; MCP Servers</p>
            <div class="space-y-1">
              <template x-for="m in prefillMcpServers" :key="m.id">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900" x-text="m.name || m.id"></span>
                  <span class="text-xs text-amber-600 font-mono" x-text="m.url || ''"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
      <div class="flex gap-2">
        <button type="button" @click="approveAllPrefills()" :disabled="approvingPrefills"
          class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all disabled:opacity-60"
          x-text="approvingPrefills ? 'Approving...' : 'Approve All'">
        </button>
        <button type="button" @click="prefillBannerDismissed = true; advancedOpen = true"
          class="px-4 py-2 text-xs font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition-all">
          Dismiss
        </button>
      </div>
    </div>

    <form @submit.prevent="saveSettings()" @keydown.enter="if ($event.target.tagName !== 'TEXTAREA' && $event.target.type !== 'submit') $event.preventDefault()" class="space-y-3">
      <!-- Model Selection -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: ${providers.length === 0 ? "true" : "false"} }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#129302;</span>
          Model
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3">
          <div id="provider-list">
          ${
            providers.length === 0
              ? `<div class="text-center py-6 text-gray-500">
              <p class="text-sm font-medium text-gray-700 mb-1">No model providers configured</p>
              <p class="text-xs">Add a provider below to get started.</p>
            </div>`
              : ""
          }
          ${providers
            .map(
              (p, i) => `
      <div id="provider-card-${escapeHtml(p.id)}"
        class="${i > 0 ? "mt-3 pt-3 border-t border-gray-200" : ""}">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <label class="inline-flex items-center cursor-pointer" title="Set as primary provider">
              <input type="radio" name="primaryProvider" value="${escapeHtml(p.id)}" x-model="primaryProvider"
                class="w-4 h-4 accent-slate-600 cursor-pointer">
            </label>
            <img src="${escapeHtml(p.iconUrl)}" alt="${escapeHtml(p.name)}" class="w-5 h-5 rounded">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-gray-800">${escapeHtml(p.name)}</p>
              </div>
              <p class="text-xs"
                :class="providerState['${p.id}']?.connected ? (providerState['${p.id}']?.userConnected ? 'text-emerald-600' : 'text-amber-600') : 'text-gray-500'"
                x-text="providerState['${p.id}']?.status || 'Checking...'"></p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <div x-show="providerState['${p.id}']?.connected" x-transition class="sm:flex-none relative"
              @click.outside="providerState['${p.id}'].showModelDropdown = false">
              <input type="text"
                x-model="providerState['${p.id}'].modelQuery"
                @focus="providerState['${p.id}'].showModelDropdown = true"
                @input="providerState['${p.id}'].showModelDropdown = true; providerState['${p.id}'].selectedModel = $event.target.value"
                @keydown.escape="providerState['${p.id}'].showModelDropdown = false"
                @keydown.enter.prevent="providerState['${p.id}'].showModelDropdown = false"
                :placeholder="providerState['${p.id}'].selectedModel || 'Auto model'"
                aria-label="${escapeHtml(p.name)} model"
                class="w-36 sm:w-44 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none bg-white placeholder-gray-500">
              <div x-show="providerState['${p.id}'].showModelDropdown" x-transition
                class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <button type="button"
                  @click="providerState['${p.id}'].selectedModel = ''; providerState['${p.id}'].modelQuery = ''; providerState['${p.id}'].showModelDropdown = false"
                  class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-500">
                  Auto model
                </button>
                <template x-for="opt in (providerModels['${p.id}'] || []).filter(o => !providerState['${p.id}'].modelQuery || o.label.toLowerCase().includes(providerState['${p.id}'].modelQuery.toLowerCase()) || o.value.toLowerCase().includes(providerState['${p.id}'].modelQuery.toLowerCase()))" :key="opt.value">
                  <button type="button"
                    @click="providerState['${p.id}'].selectedModel = opt.value; providerState['${p.id}'].modelQuery = opt.label; providerState['${p.id}'].showModelDropdown = false"
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-800"
                    x-text="opt.label">
                  </button>
                </template>
              </div>
            </div>
            <template x-if="!providerState['${p.id}']?.authMethods?.length">
              <button type="button" @click="providerState['${p.id}']?.userConnected ? disconnectProvider('${p.id}') : connectProvider('${p.id}')"
                class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                :class="providerState['${p.id}']?.userConnected ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'"
                x-text="providerState['${p.id}']?.userConnected ? 'Disconnect' : 'Connect'">
              </button>
            </template>
            <button type="button" @click="uninstallProvider('${p.id}')"
              title="Remove ${escapeHtml(p.name)}"
              class="p-1.5 text-xs rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        ${(() => {
          const authTypes = p.supportedAuthTypes || [p.authType];
          const hasMultiAuth = authTypes.length > 1;
          const hasApiKey = authTypes.includes("api-key");
          const hasOAuth = authTypes.includes("oauth");
          const hasDeviceCode = authTypes.includes("device-code");

          // Build tab bar + content panels
          let html = `<!-- Auth flow (${authTypes.join(", ")}) -->
        <div x-show="providerState['${p.id}']?.showAuthFlow" x-transition class="mt-3 pt-3 border-t border-gray-200">`;

          if (hasMultiAuth) {
            // Tab bar
            html += `
          <div class="flex gap-1 mb-3 border-b border-gray-200">`;
            for (const at of authTypes) {
              const label =
                at === "api-key"
                  ? "API Key"
                  : at === "device-code"
                    ? "Device Auth"
                    : "OAuth";
              html += `
            <button type="button" @click="providerState['${p.id}'].activeAuthTab = '${at}'"
              class="px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px"
              :class="providerState['${p.id}']?.activeAuthTab === '${at}' ? 'border-slate-600 text-slate-800 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'">${label}</button>`;
            }
            html += `
          </div>`;
          }

          // OAuth code input panel
          if (hasOAuth) {
            const showCond = hasMultiAuth
              ? `providerState['${p.id}']?.activeAuthTab === 'oauth' && providerState['${p.id}']?.showCodeInput`
              : `providerState['${p.id}']?.showCodeInput`;
            html += `
						          <div x-show="${showCond}" x-transition>
						            <div class="mb-3 text-center">
						              <a :href="'/api/v1/oauth/providers/${p.id}/login?token=' + encodeURIComponent(token)" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
						                Login with ${escapeHtml(p.name)}
						              </a>
						            </div>
						            <p class="text-xs text-gray-600 mb-2">Paste the authentication code from ${escapeHtml(p.name)}:</p>
						            <div class="flex gap-2">
						              <input type="text" x-model="providerState['${p.id}'].code" placeholder="CODE#STATE" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
						              <button type="button" @click="submitOAuthCode('${p.id}')" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
						                Submit
						              </button>
						            </div>
						            <p class="text-xs text-gray-400 mt-1">Format: CODE#STATE (copy the entire code shown after login)</p>
						          </div>`;
          }

          // Device code panel
          if (hasDeviceCode) {
            const showCond = hasMultiAuth
              ? `providerState['${p.id}']?.activeAuthTab === 'device-code' && providerState['${p.id}']?.showDeviceCode`
              : `providerState['${p.id}']?.showDeviceCode`;
            html += `
          <div x-show="${showCond}" x-transition>
            <div class="text-center">
              <p class="text-xs text-gray-600 mb-2">Enter this code at the verification page:</p>
              <p class="text-2xl font-mono font-bold text-slate-800 mb-2" x-text="providerState['${p.id}']?.userCode || ''"></p>
              <a :href="providerState['${p.id}']?.verificationUrl || 'https://auth.openai.com/codex/device'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2">
                Login
              </a>
              <p class="text-xs text-gray-400" x-text="providerState['${p.id}']?.pollStatus || 'Waiting for authorization...'"></p>
            </div>
          </div>`;
          }

          // API key panel
          if (hasApiKey) {
            const showCond = hasMultiAuth
              ? `providerState['${p.id}']?.activeAuthTab === 'api-key'`
              : `providerState['${p.id}']?.showApiKeyInput`;
            html += `
          <div x-show="${showCond}" x-transition>
            <p class="text-xs text-gray-600 mb-2">${p.apiKeyInstructions}</p>
            <div class="flex gap-2">
              <input type="password" x-model="providerState['${p.id}'].apiKey" placeholder="${escapeHtml(p.apiKeyPlaceholder)}" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <button type="button" @click="submitApiKey('${p.id}')" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                Save
              </button>
            </div>
          </div>`;
          }

          html += `
        </div>`;
          return html;
        })()}
      </div>`
            )
            .join("")}
          </div>

          <!-- Add Provider Catalog -->
          <div class="mt-3 pt-3 border-t border-gray-200" x-show="catalogProviders.length > 0">
            <div class="relative">
              <button type="button" @click="showCatalog = !showCatalog"
                class="w-full px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all flex items-center justify-center gap-2">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                Add Provider
              </button>
              <div x-show="showCatalog" @click.away="showCatalog = false" x-transition
                class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <template x-for="cp in catalogProviders" :key="cp.id">
                  <div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    @click="addProvider(cp.id)">
                    <div class="flex items-center gap-2">
                      <img :src="cp.iconUrl" :alt="cp.name" class="w-4 h-4 rounded">
                      <div class="flex-1 min-w-0">
                        <p class="text-xs font-medium text-gray-800" x-text="cp.name"></p>
                      </div>
                      <div class="flex flex-wrap gap-1 justify-end">
                        <template x-for="at in (cp.supportedAuthTypes || [cp.authType])" :key="at">
                          <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-100"
                            x-text="at"></span>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- Pending Provider Auth (shown during add flow) -->
          <div x-show="pendingProvider" x-transition class="mt-3 pt-3 border-t border-gray-200">
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <img :src="pendingProvider?.iconUrl || ''" :alt="pendingProvider?.name || ''" class="w-5 h-5 rounded">
                  <p class="text-sm font-medium text-gray-800" x-text="'Connect ' + (pendingProvider?.name || '')"></p>
                </div>
                <button type="button" @click="cancelPendingProvider()"
                  class="px-2 py-1 text-xs font-medium rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all">
                  Cancel
                </button>
              </div>

              <!-- Tab bar for multi-auth pending providers -->
              <template x-if="pendingProvider && !pendingProvider.success && (pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length > 1">
                <div class="flex gap-1 mb-3 border-b border-gray-200">
                  <template x-for="at in (pendingProvider.supportedAuthTypes || [pendingProvider.authType])" :key="at">
                    <button type="button" @click="providerState[pendingProvider.id].activeAuthTab = at; if (at !== 'api-key') connectProvider(pendingProvider.id)"
                      class="px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px"
                      :class="providerState[pendingProvider.id]?.activeAuthTab === at ? 'border-slate-600 text-slate-800 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'"
                      x-text="at">
                    </button>
                  </template>
                </div>
              </template>

              <!-- API Key input for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && (providerState[pendingProvider.id]?.activeAuthTab === 'api-key' || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'api-key'))">
                <div>
                  <p class="text-xs text-gray-600 mb-2" x-html="pendingProvider.apiKeyInstructions || 'Enter your API key:'"></p>
                  <div class="flex gap-2">
                    <input type="password" x-model="providerState[pendingProvider.id].apiKey" :placeholder="pendingProvider.apiKeyPlaceholder || 'API key'" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                    <button type="button" @click="submitApiKey(pendingProvider.id)" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                      Save
                    </button>
                  </div>
                </div>
              </template>

              <!-- OAuth code input for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && providerState[pendingProvider.id]?.activeAuthTab !== 'api-key' && (providerState[pendingProvider.id]?.showCodeInput || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'oauth'))">
                <div>
                  <div class="mb-3 text-center">
                    <a :href="'/api/v1/oauth/providers/' + pendingProvider.id + '/login?token=' + encodeURIComponent(token)" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all" x-text="'Login with ' + pendingProvider.name">
                    </a>
                  </div>
                  <p class="text-xs text-gray-600 mb-2" x-text="'Paste the authentication code from ' + pendingProvider.name + ':'"></p>
                  <div class="flex gap-2">
                    <input type="text" x-model="providerState[pendingProvider.id].code" placeholder="CODE#STATE" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                    <button type="button" @click="submitOAuthCode(pendingProvider.id)" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                      Submit
                    </button>
                  </div>
                  <p class="text-xs text-gray-400 mt-1">Format: CODE#STATE (copy the entire code shown after login)</p>
                </div>
              </template>

              <!-- Device code flow for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && providerState[pendingProvider.id]?.activeAuthTab !== 'api-key' && (providerState[pendingProvider.id]?.showDeviceCode || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'device-code'))">
                <div class="text-center">
                  <p class="text-xs text-gray-600 mb-2">Enter this code at the verification page:</p>
                  <p class="text-2xl font-mono font-bold text-slate-800 mb-2" x-text="providerState[pendingProvider.id].userCode || ''"></p>
                  <a :href="providerState[pendingProvider.id].verificationUrl || '#'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2">
                    Login
                  </a>
                  <p class="text-xs text-gray-400" x-text="providerState[pendingProvider.id].pollStatus || 'Waiting for authorization...'"></p>
                </div>
              </template>

              <!-- Success state for pending provider -->
              <template x-if="pendingProvider?.success">
                <div class="text-center py-4">
                  <svg class="w-8 h-8 mx-auto text-emerald-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                  <p class="text-sm font-medium text-emerald-700">Connected!</p>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent Instructions -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#128220;</span>
          Agent Instructions
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-3">
          <p class="text-xs text-gray-500">Define your agent's identity, behavior rules, and user context. Supports Markdown with optional YAML frontmatter (auto-stripped).</p>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">IDENTITY.md <span class="text-gray-400">- Who the agent is</span></label>
            <textarea id="identityMd" name="identityMd" placeholder="You are a helpful coding assistant named Alex.&#10;You specialize in TypeScript and React development." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.identityMd || "")}</textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">SOUL.md <span class="text-gray-400">- Behavior rules &amp; instructions</span></label>
            <textarea id="soulMd" name="soulMd" placeholder="Always write tests before implementation.&#10;Prefer functional programming patterns.&#10;Never commit directly to main branch." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[80px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.soulMd || "")}</textarea>
            <!-- Browse Souls from ClawHub -->
            <div class="mt-2">
              <div class="relative">
                <input type="text" x-model="soulSearch" @input.debounce.300ms="searchSouls()" @focus="if (!soulSearch.trim()) searchSouls(); else soulSearchVisible = true" placeholder="Browse community souls from ClawHub..." class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none" :disabled="soulSearchLoading">
                <div x-show="soulSearchVisible" @click.away="soulSearchVisible = false" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  <template x-for="item in soulSearchResults" :key="item.slug">
                    <div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" @click="loadSoul(item.slug)">
                      <div class="flex items-center justify-between">
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-medium text-gray-800 truncate" x-text="item.displayName || item.slug"></p>
                          <p class="text-xs text-gray-500 truncate" x-text="(item.summary || '').substring(0, 80)"></p>
                        </div>
                        <span class="text-xs text-slate-600 ml-2 shrink-0">Use</span>
                      </div>
                    </div>
                  </template>
                  <template x-if="soulSearchResults.length === 0 && soulSearchVisible">
                    <div class="p-2 text-xs text-gray-500" x-text="soulSearchLoading ? 'Loading...' : 'No souls found'"></div>
                  </template>
                </div>
              </div>
              <p class="text-xs text-gray-400 mt-1">Browse <a href="https://clawhub.ai/souls" target="_blank" class="text-blue-600 hover:underline">ClawHub souls</a> to use as a starting point. Content will be loaded into the textarea above for editing.</p>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">USER.md <span class="text-gray-400">- User-specific context</span></label>
            <textarea id="userMd" name="userMd" placeholder="The user prefers concise responses.&#10;Their timezone is UTC+3.&#10;They use VS Code as their IDE." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.userMd || "")}</textarea>
          </div>
        </div>
      </div>

      <!-- Integrations Section (Skills + MCP) -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#128268;</span>
          Integrations
          <span x-show="skillsLoading || mcpsLoading" class="animate-spin text-slate-600">&#8635;</span>
          <span x-show="skills.length + mcpServerIds.length > 0" class="text-xs text-gray-400" x-text="'(' + (skills.length + mcpServerIds.length) + ')'"></span>
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-3">

          <!-- Errors -->
          <div x-show="skillsError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs" x-text="skillsError"></div>
          <div x-show="mcpsError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs" x-text="mcpsError"></div>

          <!-- Installed Integrations List -->
          <div class="space-y-2">
            <template x-if="skills.length === 0 && mcpServerIds.length === 0">
              <p class="text-xs text-gray-500">No integrations configured yet.</p>
            </template>
            <template x-for="skill in skills" :key="'skill-' + skill.repo">
              <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">skill</span>
                  <div class="min-w-0">
                    <a :href="'https://clawhub.ai/skills/' + encodeURIComponent(skill.repo)" target="_blank" class="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline truncate block" x-text="skill.name"></a>
                    <p x-show="skill.description" class="text-xs text-gray-500 truncate" x-text="skill.description"></p>
                  </div>
                </div>
                <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button type="button" @click="toggleSkill(skill.repo)"
                    class="px-2 py-1 text-xs rounded"
                    :class="skill.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                    x-text="skill.enabled ? 'Enabled' : 'Disabled'"></button>
                  <button type="button" @click="removeSkill(skill.repo)" class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                </div>
              </div>
            </template>
            <template x-for="mcpId in mcpServerIds" :key="'mcp-' + mcpId">
              <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">mcp</span>
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-gray-800 truncate" x-text="mcpId"></p>
                    <p x-show="getMcpDescription(mcpId)" class="text-xs text-gray-500 truncate" x-text="getMcpDescription(mcpId)"></p>
                  </div>
                </div>
                <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button type="button" @click="toggleMcp(mcpId)"
                    class="px-2 py-1 text-xs rounded"
                    :class="mcpServers[mcpId]?.enabled !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                    x-text="mcpServers[mcpId]?.enabled !== false ? 'Enabled' : 'Disabled'"></button>
                  <button type="button" @click="removeMcp(mcpId)" class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                </div>
              </div>
            </template>
          </div>

          <!-- Unified Search -->
          <div class="border-t border-gray-100 pt-2">
            <div class="relative mb-2">
              <input type="text" x-model="integrationSearch" @input.debounce.300ms="searchIntegrations()" @focus="if (integrationSearch.trim() && !integrationSearch.trim().startsWith('http') && !integrationSearch.trim().includes('://')) integrationSearchVisible = true" placeholder="Search integrations or paste MCP URL..." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <div x-show="integrationSearchVisible" @click.away="integrationSearchVisible = false" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <template x-for="result in integrationSearchResults" :key="result.type + '-' + result.id">
                  <div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" @click="addIntegrationFromSearch(result)">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0" :class="result.type === 'skill' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'" x-text="result.type"></span>
                        <div class="min-w-0">
                          <p class="text-xs font-medium text-gray-800 truncate" x-text="result.name"></p>
                          <p x-show="result.description" class="text-xs text-gray-500 truncate" x-text="result.description"></p>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 ml-2">
                        <span x-show="result.type === 'skill' && result.installs" class="text-xs text-gray-400" x-text="formatInstalls(result.installs)"></span>
                        <span class="text-xs" :class="isIntegrationAdded(result) ? 'text-green-600' : 'text-slate-600'" x-text="isIntegrationAdded(result) ? 'Added' : '+ Add'"></span>
                      </div>
                    </div>
                  </div>
                </template>
                <template x-if="integrationSearchResults.length === 0 && integrationSearchVisible">
                  <div class="p-2 text-xs text-gray-500">No integrations found</div>
                </template>
              </div>
            </div>

            <!-- Curated Chips (only when no integrations exist) -->
            <div class="mb-2" x-show="skills.length === 0 && mcpServerIds.length === 0">
              <div class="flex flex-wrap gap-1">
                <template x-for="cs in curatedSkills" :key="'cs-' + cs.repo">
                  <button type="button" @click="addSkillFromChip(cs.repo)"
                    class="px-2 py-1 text-xs rounded-full bg-purple-50 text-slate-800 border border-purple-200"
                    :class="skills.some(function(sk) { return sk.repo === cs.repo }) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-100'"
                    :disabled="skills.some(function(sk) { return sk.repo === cs.repo })"
                    :title="skills.some(function(sk) { return sk.repo === cs.repo }) ? 'Already added' : cs.description"
                    x-text="cs.name"></button>
                </template>
                <template x-for="cm in curatedMcps" :key="'cm-' + cm.id">
                  <button type="button" @click="addMcpFromChip(cm.id)"
                    class="px-2 py-1 text-xs rounded-full bg-blue-50 text-slate-800 border border-blue-200"
                    :class="mcpServers.hasOwnProperty(cm.id) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-blue-100'"
                    :disabled="mcpServers.hasOwnProperty(cm.id)"
                    :title="mcpServers.hasOwnProperty(cm.id) ? 'Already added' : cm.description"
                    x-text="cm.name"></button>
                </template>
              </div>
            </div>

            <p class="text-xs text-gray-400 mt-1">Extend your agent with <a href="https://clawhub.ai/skills" target="_blank" class="text-blue-600 hover:underline">skills from ClawHub</a> and MCP servers.</p>
          </div>

        </div>
      </div>

      <!-- Scheduled Reminders Section -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#9200;</span>
          Scheduled Reminders
          <span x-show="schedulesLoading" class="animate-spin text-slate-600">&#8635;</span>
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3">
          <div x-show="schedulesError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs mb-2" x-text="schedulesError"></div>
          <div class="space-y-2">
            <template x-if="schedules.length === 0">
              <p class="text-xs text-gray-500">No scheduled reminders.</p>
            </template>
            <template x-for="schedule in schedules" :key="schedule.scheduleId">
              <div class="flex items-start justify-between p-2 bg-white rounded border border-gray-200">
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-gray-800 truncate" :title="schedule.task" x-text="truncateText(schedule.task, 60)"></p>
                  <p class="text-xs text-gray-500">
                    <span class="inline-block px-1.5 py-0.5 rounded text-xs"
                      :class="schedule.status === 'pending' ? 'bg-slate-100 text-slate-800' : schedule.status === 'triggered' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                      x-text="schedule.status"></span>
                    <template x-if="schedule.isRecurring && schedule.cron">
                      <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 ml-1" :title="'Cron: ' + schedule.cron" x-text="'&#128260; ' + schedule.iteration + '/' + schedule.maxIterations"></span>
                    </template>
                    <span :title="new Date(schedule.scheduledFor).toLocaleString()" class="ml-1" x-text="formatTimeRemaining(schedule.scheduledFor)"></span>
                    <template x-if="schedule.isRecurring && schedule.cron">
                      <span class="text-gray-400 ml-1" x-text="'(' + schedule.cron + ')'"></span>
                    </template>
                  </p>
                </div>
                <template x-if="schedule.status === 'pending'">
                  <button type="button" @click="cancelSchedule(schedule.scheduleId)" class="ml-2 px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 flex-shrink-0">Cancel</button>
                </template>
              </div>
            </template>
          </div>
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-xs font-medium text-gray-600 mb-1">Example prompts:</p>
            <p class="text-xs text-gray-500 mb-1 font-medium">One-time:</p>
            <ul class="text-xs text-gray-500 space-y-1 mb-2">
              <li>&bull; "Remind me in 30 minutes to check the build status"</li>
              <li>&bull; "Set a reminder for 2 hours from now to review the PR"</li>
            </ul>
            <p class="text-xs text-gray-500 mb-1 font-medium">Recurring:</p>
            <ul class="text-xs text-gray-500 space-y-1">
              <li>&bull; "Check the API status every 30 minutes for the next 2 hours"</li>
              <li>&bull; "Poll the deployment health every hour until it succeeds (max 12 checks)"</li>
              <li>&bull; "Send me a morning standup reminder at 9am on weekdays"</li>
            </ul>
            <p class="text-xs text-gray-400 mt-2">One-time: max 24 hours. Recurring: min 5 min interval, max 100 iterations.</p>
          </div>
        </div>
      </div>

      <!-- Advanced Section -->
      <div class="border border-gray-200 rounded-lg">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none p-3" @click="advancedOpen = !advancedOpen">
          <span>&#9881;</span>
          Advanced
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="advancedOpen ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="advancedOpen" x-transition class="px-3 pb-3 space-y-3">

      <!-- Network Configuration -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#127760;</span>
          Network Access
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-3">
          <div>
            <label for="allowedDomains" class="block text-xs font-medium text-gray-600 mb-1">Allowed Domains</label>
            <textarea id="allowedDomains" name="allowedDomains" placeholder="github.com&#10;*.trusted.com" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(
              (() => {
                const existing = s.networkConfig?.allowedDomains || [];
                const prefill = payload.prefillAllowedDomains || [];
                const merged = [...new Set([...existing, ...prefill])];
                return merged.join("\n");
              })()
            )}</textarea>
          </div>
          <div>
            <label for="deniedDomains" class="block text-xs font-medium text-gray-600 mb-1">Denied Domains</label>
            <textarea id="deniedDomains" name="deniedDomains" placeholder="malicious.com" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.networkConfig?.deniedDomains || []).join("\n"))}</textarea>
          </div>
        </div>
      </div>

      <!-- Git Configuration -->
      ${
        githubAppConfigured
          ? `
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#128193;</span>
          Git Repository
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-2">
          <!-- GitHub User Connection -->
          <div class="mb-3 pb-3 border-b border-gray-200">
            <div x-show="githubUserLoading" class="text-center py-2">
              <p class="text-xs text-gray-500">Checking GitHub connection...</p>
            </div>
            <div x-show="!githubUserLoading && !githubUser && githubOAuthConfigured" class="text-center py-2">
              <p class="text-xs text-gray-600 mb-2">Connect your GitHub account to see your repositories</p>
              <a :href="'/api/v1/oauth/github/login?token=' + encodeURIComponent(token)" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-all">
                <svg class="w-4 h-4 inline-block mr-1" viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="currentColor"/></svg>
                Connect with GitHub
              </a>
            </div>
            <div x-show="!githubUserLoading && githubUser" class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <img :src="githubUser?.avatarUrl || ''" :alt="githubUser?.login || ''" class="w-6 h-6 rounded-full">
                <div>
                  <p class="text-xs font-medium text-gray-800" x-text="githubUser?.login || ''"></p>
                  <p class="text-xs text-green-600">Connected</p>
                </div>
              </div>
              <button type="button" @click="disconnectGitHub()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-all">
                Disconnect
              </button>
            </div>
            <div x-show="!githubUserLoading && !githubUser && !githubOAuthConfigured" class="text-center py-2">
              <p class="text-xs text-gray-400">GitHub authentication not configured</p>
            </div>
          </div>

          <!-- Loading state -->
          <div x-show="gitLoading" class="text-center py-4">
            <p class="text-xs text-gray-500">Loading GitHub installations...</p>
          </div>

          <!-- Install prompt -->
          <div x-show="showInstallPrompt && !gitLoading" class="text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
            <p class="text-xs text-gray-600 mb-2">Install the GitHub App to enable repository access</p>
            <div class="flex items-center justify-center gap-2">
              ${
                githubAppInstallUrl
                  ? `<a href="${escapeHtml(githubAppInstallUrl)}" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-all">
                Install on GitHub &rarr;
              </a>`
                  : `<p class="text-xs text-gray-400">Contact administrator to install the GitHub App</p>`
              }
              <button type="button" @click="refreshGitHub()" class="px-4 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 transition-all">
                &#8635; Refresh
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-2">After installing, click Refresh to see your repositories</p>
          </div>

          <!-- Repo selection -->
          <div x-show="showRepoSelection && !gitLoading" class="space-y-2">
            <div>
              <label for="gitOrg" class="block text-xs font-medium text-gray-600 mb-1">Organization / User</label>
              <select id="gitOrg" name="gitOrg" @change="onOrgChange($event.target.value)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                <option value="">Select...</option>
                <template x-for="inst in githubInstallations" :key="inst.id">
                  <option :value="inst.id" :selected="inst.id == selectedOrg" x-text="inst.account + (inst.accountType === 'Organization' ? ' (org)' : '')"></option>
                </template>
              </select>
            </div>
            <div>
              <label for="gitRepo" class="block text-xs font-medium text-gray-600 mb-1">Repository</label>
              <select id="gitRepo" name="gitRepo" @change="onRepoChange($event.target)" :disabled="!selectedOrg" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                <template x-if="!selectedOrg">
                  <option value="">Select organization first...</option>
                </template>
                <template x-if="selectedOrg && repoOptions.length === 0">
                  <option value="">Loading...</option>
                </template>
                <template x-if="selectedOrg && repoOptions.length > 0">
                  <option value="">Select...</option>
                </template>
                <template x-for="repo in repoOptions" :key="repo.name">
                  <option :value="repo.name" :data-full-name="repo.fullName" :data-owner="repo.owner" :data-default-branch="repo.defaultBranch" :selected="repo.name === selectedRepo" x-text="repo.name + (repo.private ? ' &#128274;' : '')"></option>
                </template>
              </select>
            </div>
            <div>
              <label for="gitBranch" class="block text-xs font-medium text-gray-600 mb-1">Branch</label>
              <select id="gitBranch" name="gitBranch" @change="onBranchChange($event.target.value)" :disabled="!selectedRepo" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                <template x-if="!selectedRepo">
                  <option value="">Select repository first...</option>
                </template>
                <template x-for="br in branchOptions" :key="br.name">
                  <option :value="br.name" :selected="br.name === selectedBranch" x-text="br.name + (br.protected ? ' &#128737;&#65039;' : '') + (br.isDefault ? ' (default)' : '')"></option>
                </template>
              </select>
            </div>
            <div>
              <label for="sparse" class="block text-xs font-medium text-gray-600 mb-1">Sparse Checkout (optional)</label>
              <textarea id="sparse" name="sparse" placeholder="src/&#10;docs/" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[50px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.gitConfig?.sparse || []).join("\n"))}</textarea>
              <p class="text-xs text-gray-400 mt-1">Only checkout specific directories (one per line)</p>
            </div>
          </div>

          <!-- Hidden fields for form submission -->
          <input type="hidden" id="repoUrl" name="repoUrl" :value="repoUrlValue">
          <input type="hidden" id="branch" name="branch" :value="selectedBranch">
          <input type="hidden" id="selectedInstallationId" name="selectedInstallationId" :value="currentInstallationId || ''">
        </div>
      </div>
      `
          : `
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#128193;</span>
          Git Repository
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-2">
          <p class="text-xs text-gray-500">GitHub App is not configured. You can still use a manual repository URL.</p>
          <div>
            <label for="repoUrl" class="block text-xs font-medium text-gray-600 mb-1">Repository URL</label>
            <input id="repoUrl" name="repoUrl" type="text" placeholder="https://github.com/owner/repo" value="${escapeHtml(s.gitConfig?.repoUrl || "")}" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          </div>
          <div>
            <label for="branch" class="block text-xs font-medium text-gray-600 mb-1">Branch (optional)</label>
            <input id="branch" name="branch" type="text" placeholder="main" value="${escapeHtml(s.gitConfig?.branch || "")}" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          </div>
          <div>
            <label for="sparse" class="block text-xs font-medium text-gray-600 mb-1">Sparse Checkout (optional)</label>
            <textarea id="sparse" name="sparse" placeholder="src/&#10;docs/" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[50px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.gitConfig?.sparse || []).join("\n"))}</textarea>
            <p class="text-xs text-gray-400 mt-1">Only checkout specific directories (one per line)</p>
          </div>
        </div>
      </div>
      `
      }

      <!-- System Packages -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="{ open: false }">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="open = !open">
          <span>&#128230;</span>
          System Packages
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="open ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="open" x-transition class="pt-3 space-y-3">
          <div>
            <label for="nixPackages" class="block text-xs font-medium text-gray-600 mb-1">Packages (one per line)</label>
            <textarea id="nixPackages" name="nixPackages" placeholder="python311&#10;ffmpeg&#10;jq" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(
              (() => {
                const existing = s.nixConfig?.packages || [];
                const prefill = payload.prefillNixPackages || [];
                const merged = [...new Set([...existing, ...prefill])];
                return merged.join("\n");
              })()
            )}</textarea>
          </div>
        </div>
      </div>

      <!-- Environment Variables -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="envVarsOpen = !envVarsOpen">
          <span>&#128203;</span>
          Environment Variables
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="envVarsOpen ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="envVarsOpen" x-transition class="pt-3">
          <textarea id="envVars" name="envVars" placeholder="API_KEY=your_key&#10;DEBUG=true" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(envVarsValue)}</textarea>
        </div>
      </div>

      <!-- Verbose Logging -->
      <div class="bg-gray-50 rounded-lg p-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="verboseLogging" name="verboseLogging" ${s.verboseLogging ? "checked" : ""} class="w-4 h-4 text-slate-600 rounded focus:ring-slate-500">
          <span class="text-sm font-medium text-gray-800">Verbose logging</span>
        </label>
        <p class="text-xs text-gray-500 mt-1 ml-6">Show tool calls, reasoning tokens, and detailed output</p>
      </div>

        </div>
      </div>

      <button type="submit" :disabled="saving"
        class="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
        x-text="saving ? 'Saving...' : 'Save Settings'">
      </button>
    </form>
  </div>

  <script>
    const __STATE__ = ${JSON.stringify(initialState)};

    function settingsApp() {
      return {
        // Config
        token: __STATE__.token,
        agentId: __STATE__.agentId,
        githubOAuthConfigured: __STATE__.githubOAuthConfigured,
        githubAppConfigured: __STATE__.githubAppConfigured,
        githubAppInstallUrl: __STATE__.githubAppInstallUrl,
        PROVIDERS: __STATE__.PROVIDERS,

        // Agent Identity
        agentName: __STATE__.agentName || '',
        agentDescription: __STATE__.agentDescription || '',
        _initialAgentName: __STATE__.agentName || '',
        _initialAgentDescription: __STATE__.agentDescription || '',
        savingIdentity: false,
        hasChannelId: __STATE__.hasChannelId || false,

        // UI
        successMsg: '',
        errorMsg: '',
        saving: false,

        // Providers
        providerState: {},
        providerOrder: Array.isArray(__STATE__.providerOrder)
          ? __STATE__.providerOrder.slice()
          : [],
        primaryProvider: '',
        providerModels: __STATE__.providerModels || {},
        catalogProviders: __STATE__.catalogProviders || [],
        showCatalog: false,
        pendingProvider: null,
        deviceCodePollTimer: null,

        // GitHub
        githubUser: null,
        githubUserLoading: true,
        githubInstallations: [],
        githubRepos: {},
        currentInstallationId: null,
        selectedOrg: '',
        selectedRepo: '',
        selectedBranch: '',
        repoUrlValue: ${JSON.stringify(s.gitConfig?.repoUrl || "")},
        repoOptions: [],
        branchOptions: [],
        gitLoading: false,
        showInstallPrompt: false,
        showRepoSelection: false,

        // Skills
        skills: __STATE__.initialSkills,
        skillsLoading: false,
        skillsError: '',
        curatedSkills: [],

        // Soul search
        soulSearch: '',
        soulSearchResults: [],
        soulSearchVisible: false,
        soulSearchLoading: false,

        // MCPs
        mcpServers: __STATE__.initialMcpServers,
        mcpsLoading: false,
        mcpsError: '',
        curatedMcps: [],

        // Unified integration search
        integrationSearch: '',
        integrationSearchResults: [],
        integrationSearchVisible: false,

        // Schedules
        schedules: [],
        schedulesLoading: false,
        schedulesError: '',

        // Prefills
        prefillSkills: __STATE__.prefillSkills,
        prefillMcpServers: __STATE__.prefillMcpServers,
        prefillAllowedDomains: __STATE__.prefillAllowedDomains,
        prefillNixPackages: __STATE__.prefillNixPackages,
        prefillEnvVars: __STATE__.prefillEnvVars,
        prefillBannerDismissed: false,
        approvingPrefills: false,

        // Section open states (lifted for programmatic control)
        advancedOpen: false,
        envVarsOpen: false,

        get hasPrefills() {
          return !!(this.prefillAllowedDomains.length || this.prefillNixPackages.length || this.prefillEnvVars.length || this.prefillSkills.length || this.prefillMcpServers.length);
        },

        get mcpServerIds() {
          return Object.keys(this.mcpServers);
        },

        init() {
          var providerIds = this.providerOrder.length
            ? this.providerOrder.slice()
            : Object.keys(this.PROVIDERS);
          this.providerOrder = providerIds.filter(function(pid) {
            return !!__STATE__.PROVIDERS[pid];
          });

          // Initialize provider state
          for (var i = 0; i < this.providerOrder.length; i++) {
            var pid = this.providerOrder[i];
            var selectedModel = '';
            var pInfo = this.PROVIDERS[pid] || {};
            var authTypes = pInfo.supportedAuthTypes || [pInfo.authType || 'oauth'];
            this.providerState[pid] = {
              status: 'Checking...',
              connected: false,
              userConnected: false,
              systemConnected: false,
              showAuthFlow: false,
              showCodeInput: false,
              showDeviceCode: false,
              showApiKeyInput: false,
              activeAuthTab: authTypes[0] || 'oauth',
              code: '',
              apiKey: '',
              userCode: '',
              verificationUrl: '',
              pollStatus: 'Waiting for authorization...',
              deviceAuthId: '',
              selectedModel: selectedModel,
              modelQuery: '',
              showModelDropdown: false
            };
          }
          this.primaryProvider = this.providerOrder.length ? this.providerOrder[0] : '';

          // Check for github_connected query param
          var urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('github_connected') === 'true') {
            this.successMsg = 'GitHub account connected!';
            var newUrl = window.location.pathname + '?token=' + encodeURIComponent(this.token);
            window.history.replaceState({}, '', newUrl);
          }

          this.checkProviders();
          this.initIntegrations();
          this.initSchedules();
          if (this.githubAppConfigured) {
            this.initGitHubUser();
          } else {
            this.githubUserLoading = false;
          }
        },

        // === Helpers ===
        parseLines(text) {
          return text.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
        },

        formatInstalls(num) {
          if (!num) return '0';
          if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
          return num.toString();
        },

        truncateText(text, maxLength) {
          if (!text) return '';
          if (text.length <= maxLength) return text;
          return text.slice(0, maxLength - 3) + '...';
        },

        mcpIdFromUrl(url) {
          try {
            var hostname = new URL(url).hostname;
            return hostname.replace(/./g, '-');
          } catch (e) {
            return url.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
          }
        },

        formatTimeRemaining(scheduledFor) {
          var scheduledDate = new Date(scheduledFor);
          var now = new Date();
          var minutesRemaining = Math.max(0, Math.round((scheduledDate - now) / (1000 * 60)));
          if (minutesRemaining === 0) return 'Due now';
          if (minutesRemaining < 60) return 'in ' + minutesRemaining + ' min';
          var hours = Math.floor(minutesRemaining / 60);
          var mins = minutesRemaining % 60;
          return 'in ' + hours + 'h ' + mins + 'm';
        },

        getMcpDescription(mcpId) {
          var config = this.mcpServers[mcpId];
          if (!config) return '';
          if (config.description) return config.description;
          if (config.url) return config.url;
          if (config.command) return config.command + ' ' + (config.args || []).join(' ');
          return '';
        },

        apiUrl(path) {
          return '/api/v1/agents/' + encodeURIComponent(this.agentId) + path + '?token=' + encodeURIComponent(this.token);
        },

        async switchAgent(agentId) {
          try {
            var resp = await fetch('/settings/switch-agent?token=' + encodeURIComponent(this.token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: agentId })
            });
            var result = await resp.json();
            if (resp.ok) {
              window.location.reload();
            } else {
              this.errorMsg = result.error || 'Failed to switch agent';
            }
          } catch (e) {
            this.errorMsg = 'Network error: ' + e.message;
          }
        },

        // === Agent Identity ===
        async saveIdentity() {
          this.savingIdentity = true;
          this.successMsg = '';
          this.errorMsg = '';

          try {
            var body = {};
            if (this.agentName !== this._initialAgentName) body.name = this.agentName;
            if (this.agentDescription !== this._initialAgentDescription) body.description = this.agentDescription;

            var resp = await fetch('/settings/update-agent?token=' + encodeURIComponent(this.token), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            var result = await resp.json();
            if (resp.ok) {
              this._initialAgentName = this.agentName;
              this._initialAgentDescription = this.agentDescription;
              this.successMsg = 'Agent identity updated!';
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              throw new Error(result.error || 'Failed to update');
            }
          } catch (e) {
            this.errorMsg = e.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } finally {
            this.savingIdentity = false;
          }
        },

        async createAgentFromSwitcher(name) {
          if (!name || !name.trim()) return;
          var agentId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (agentId.length > 40) agentId = agentId.substring(0, 40);
          if (agentId.length < 3 || !/^[a-z]/.test(agentId)) {
            this.errorMsg = 'Invalid agent name (must start with a letter, at least 3 characters)';
            return;
          }

          try {
            var resp = await fetch('/settings/create-agent?token=' + encodeURIComponent(this.token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: agentId, name: name.trim() })
            });
            var result = await resp.json();
            if (resp.ok) {
              window.location.reload();
            } else {
              this.errorMsg = result.error || 'Failed to create agent';
            }
          } catch (e) {
            this.errorMsg = 'Network error: ' + e.message;
          }
        },

        async deleteAgent() {
          try {
            var resp = await fetch('/api/v1/agent-management/agents/' + encodeURIComponent(this.agentId) + '?token=' + encodeURIComponent(this.token), {
              method: 'DELETE'
            });
            var result = await resp.json();
            if (resp.ok) {
              if (this.hasChannelId) {
                window.location.reload();
              } else {
                document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;color:white"><p style="font-size:1.5rem;margin-bottom:0.5rem">Agent deleted</p><p style="font-size:0.875rem;opacity:0.7">This agent has been permanently removed.</p></div></div>';
              }
            } else {
              this.errorMsg = result.error || 'Failed to delete agent';
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          } catch (e) {
            this.errorMsg = 'Network error: ' + e.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        },

        // === Provider Install/Uninstall ===
        addProvider(providerId) {
          var cp = this.catalogProviders.find(function(c) { return c.id === providerId; });
          if (!cp) return;

          this.showCatalog = false;
          this.pendingProvider = cp;

          var authTypes = cp.supportedAuthTypes || [cp.authType];
          var primaryAuth = authTypes[0] || cp.authType;

          // Initialize temporary provider state for the auth flow
          this.providerState[providerId] = {
            status: 'Connecting...',
            connected: false,
            userConnected: false,
            systemConnected: false,
            showAuthFlow: true,
            showCodeInput: false,
            showDeviceCode: false,
            showApiKeyInput: false,
            activeAuthTab: primaryAuth,
            code: '',
            apiKey: '',
            userCode: '',
            verificationUrl: '',
            pollStatus: '',
            deviceAuthId: '',
            selectedModel: '',
            modelQuery: '',
            showModelDropdown: false
          };

          // Start the auth flow based on primary authType
          if (primaryAuth === 'api-key') {
            this.providerState[providerId].showApiKeyInput = true;
            this.providerState[providerId].status = 'Enter your API key...';
          } else if (primaryAuth === 'device-code') {
            this.connectDeviceCode(providerId);
          } else {
            // OAuth
            this.providerState[providerId].showCodeInput = true;
            this.providerState[providerId].status = 'Click Login to start authentication.';
          }
        },

        cancelPendingProvider() {
          if (this.pendingProvider) {
            var pid = this.pendingProvider.id;
            if (this.deviceCodePollTimer) {
              clearInterval(this.deviceCodePollTimer);
              this.deviceCodePollTimer = null;
            }
            delete this.providerState[pid];
            this.pendingProvider = null;
          }
        },

        async installAndReload(providerId, message) {
          try {
            var resp = await fetch(this.apiUrl('/config/providers/install'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providerId: providerId })
            });
            if (resp.ok) {
              this.successMsg = message || 'Provider added and connected!';
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(function() { window.location.reload(); }, 800);
            } else {
              var data = await resp.json().catch(function() { return {}; });
              this.errorMsg = data.error || 'Failed to install provider';
            }
          } catch (e) {
            this.errorMsg = e.message || 'Failed to install provider';
          }
        },

        async uninstallProvider(providerId) {
          if (!confirm('Remove ' + (this.PROVIDERS[providerId]?.name || providerId) + '? This will also remove saved credentials.')) return;
          try {
            var resp = await fetch(this.apiUrl('/config/providers/uninstall'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providerId: providerId })
            });
            if (resp.ok) {
              this.successMsg = 'Provider removed! Refreshing...';
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(function() { window.location.reload(); }, 800);
            } else {
              var data = await resp.json().catch(function() { return {}; });
              this.errorMsg = data.error || 'Failed to remove provider';
            }
          } catch (e) {
            this.errorMsg = e.message || 'Failed to remove provider';
          }
        },

        // === Form Submission ===
        async saveSettings() {
          this.saving = true;
          this.successMsg = '';
          this.errorMsg = '';

          var settings = {};

          // Reorder installed providers via catalog API (primary provider first)
          if (this.providerOrder.length > 0 && this.primaryProvider) {
            try {
              var orderedIds = [this.primaryProvider].concat(
                this.providerOrder.filter(function(pid) { return pid !== this.primaryProvider; }.bind(this))
              );
              await fetch(this.apiUrl('/config/providers/reorder'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerIds: orderedIds })
              });
            } catch (e) {
              // Non-fatal: continue saving other settings
            }
          }

          // Always clear explicit model override so provider order controls routing.
          settings.model = '';

          // Workspace files
          settings.identityMd = document.getElementById('identityMd').value;
          settings.soulMd = document.getElementById('soulMd').value;
          settings.userMd = document.getElementById('userMd').value;

          // Network config
          var allowedDomains = this.parseLines(document.getElementById('allowedDomains').value);
          var deniedDomains = this.parseLines(document.getElementById('deniedDomains').value);
          if (allowedDomains.length || deniedDomains.length) {
            settings.networkConfig = {};
            if (allowedDomains.length) settings.networkConfig.allowedDomains = allowedDomains;
            if (deniedDomains.length) settings.networkConfig.deniedDomains = deniedDomains;
          }

          // Git config
          var repoUrl = document.getElementById('repoUrl').value.trim();
          var branch = document.getElementById('branch').value.trim();
          var sparse = this.parseLines(document.getElementById('sparse').value);
          if (repoUrl || branch || sparse.length) {
            if (!repoUrl) {
              this.errorMsg = 'Repository URL is required when Git config is set';
              this.saving = false;
              window.scrollTo({ top: 0, behavior: 'smooth' });
              return;
            }
            settings.gitConfig = {};
            settings.gitConfig.repoUrl = repoUrl;
            if (branch) settings.gitConfig.branch = branch;
            if (sparse.length) settings.gitConfig.sparse = sparse;
          } else {
            settings.gitConfig = null;
          }

          // System packages
          var nixPackages = this.parseLines(document.getElementById('nixPackages').value);
          if (nixPackages.length) {
            settings.nixConfig = { packages: nixPackages };
          } else {
            settings.nixConfig = null;
          }

          // Environment variables
          var envVarsText = document.getElementById('envVars').value;
          var envVarsLines = this.parseLines(envVarsText);
          if (envVarsLines.length) {
            settings.envVars = {};
            for (var i = 0; i < envVarsLines.length; i++) {
              var line = envVarsLines[i];
              var eqIdx = line.indexOf('=');
              if (eqIdx > 0) {
                var key = line.slice(0, eqIdx).trim();
                var value = line.slice(eqIdx + 1);
                if (key) settings.envVars[key] = value;
              }
            }
          }

          // Verbose logging
          settings.verboseLogging = document.getElementById('verboseLogging').checked;

          try {
            var response = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            });

            var result = await response.json();

            if (response.ok) {
              this.successMsg = 'Settings saved!';
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              throw new Error(result.error || 'Failed to save settings');
            }
          } catch (error) {
            this.errorMsg = error.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } finally {
            this.saving = false;
          }
        },

        // === Provider Auth ===
        async checkProviders() {
          try {
            var resp = await fetch(this.apiUrl('/config'));
            var data = await resp.json();
            for (var provider in (data.providers || {})) {
              var info = data.providers[provider];
              this.updateProviderStatus(
                provider,
                info.connected,
                info.userConnected,
                info.systemConnected,
                info.activeAuthType,
                info.authMethods
              );
            }
          } catch (e) {
            if (this.providerState['claude']) {
              this.providerState['claude'].status = 'Error checking status';
            }
          }
        },

        updateProviderStatus(provider, connected, userConnected, systemConnected, activeAuthType, authMethods) {
          if (!this.providerState[provider]) return;
          var ps = this.providerState[provider];
          ps.connected = !!connected;
          ps.userConnected = !!userConnected;
          ps.systemConnected = !!systemConnected;
          ps.activeAuthType = activeAuthType || null;
          ps.authMethods = authMethods || [];
          ps.status = !ps.connected
            ? 'Not connected'
            : ps.userConnected
              ? 'Connected via ' + (ps.activeAuthType || 'unknown')
              : 'Using system key';
        },

        connectProvider(provider) {
          var info = this.PROVIDERS[provider];
          if (!info) return;

          var ps = this.providerState[provider];
          if (!ps) return;

          var authTypes = info.supportedAuthTypes || [info.authType || 'oauth'];
          var hasMultiAuth = authTypes.length > 1;

          // Show the auth flow container
          ps.showAuthFlow = true;

          // Determine which auth tab to activate
          var activeTab = hasMultiAuth ? (ps.activeAuthTab || authTypes[0]) : info.authType;

          if (activeTab === 'api-key') {
            ps.activeAuthTab = 'api-key';
            ps.showApiKeyInput = true;
            ps.status = 'Enter your API key...';
            return;
          }

          if (activeTab === 'device-code') {
            ps.activeAuthTab = 'device-code';
            this.connectDeviceCode(provider);
            return;
          }

          // OAuth flow
          ps.activeAuthTab = 'oauth';
          ps.showCodeInput = true;
          ps.status = 'Click Login to start authentication.';
        },

        async submitOAuthCode(provider) {
          var code = (this.providerState[provider].code || '').trim();
          if (!code) {
            this.errorMsg = 'Please enter the authentication code';
            return;
          }

          try {
            var resp = await fetch('/api/v1/oauth/providers/' + provider + '/code?token=' + encodeURIComponent(this.token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: code })
            });

            var result = await resp.json();

            if (resp.ok) {
              this.providerState[provider].showCodeInput = false;
              this.providerState[provider].showAuthFlow = false;
              this.providerState[provider].code = '';

              // If this is a pending add flow, show success then install
              if (this.pendingProvider && this.pendingProvider.id === provider) {
                this.pendingProvider = Object.assign({}, this.pendingProvider, { success: true });
                var self = this;
                setTimeout(async function() {
                  self.pendingProvider = null;
                  await self.installAndReload(provider, 'Provider added and connected!');
                }, 800);
                return;
              }

              this.updateProviderStatus(provider, true, true, false);
              this.successMsg = 'Connected to ' + (this.PROVIDERS[provider]?.name || provider) + '!';
            } else {
              throw new Error(result.error || 'Failed to verify code');
            }
          } catch (e) {
            this.errorMsg = e.message;
          }
        },

        async submitApiKey(provider) {
          var apiKey = (this.providerState[provider].apiKey || '').trim();
          if (!apiKey) return;

          try {
            var resp = await fetch('/api/v1/auth/' + provider + '/save-key', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: this.agentId, apiKey: apiKey })
            });

            var result = await resp.json();

            if (resp.ok) {
              this.providerState[provider].showApiKeyInput = false;
              this.providerState[provider].showAuthFlow = false;
              this.providerState[provider].apiKey = '';

              // If this is a pending add flow, show success then install
              if (this.pendingProvider && this.pendingProvider.id === provider) {
                this.pendingProvider = Object.assign({}, this.pendingProvider, { success: true });
                var self = this;
                setTimeout(async function() {
                  self.pendingProvider = null;
                  await self.installAndReload(provider, 'Provider added and connected!');
                }, 800);
                return;
              }

              this.updateProviderStatus(provider, true, true, false);
              this.successMsg = 'Connected to ' + (this.PROVIDERS[provider]?.name || provider) + '!';
            } else {
              throw new Error(result.error || 'Failed to save API key');
            }
          } catch (e) {
            this.errorMsg = e.message;
          }
        },

        async connectDeviceCode(provider) {
          var ps = this.providerState[provider];
          try {
            ps.status = 'Starting...';

            var resp = await fetch('/api/v1/auth/' + provider + '/start', { method: 'POST' });
            var data = await resp.json();

            if (!resp.ok) throw new Error(data.error || 'Failed to start auth');

            ps.userCode = data.userCode;
            ps.verificationUrl = data.verificationUrl || 'https://auth.openai.com/codex/device';
            ps.deviceAuthId = data.deviceAuthId;
            ps.showDeviceCode = true;
            ps.status = 'Waiting for authorization...';
            ps.pollStatus = 'Waiting for authorization...';

            var interval = Math.max((data.interval || 5) * 1000, 3000);
            var self = this;
            this.deviceCodePollTimer = setInterval(function() {
              self.pollDeviceCodeToken(provider);
            }, interval);

          } catch (e) {
            ps.status = 'Error: ' + e.message;
          }
        },

        async pollDeviceCodeToken(provider) {
          var ps = this.providerState[provider];
          try {
            var resp = await fetch('/api/v1/auth/' + provider + '/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deviceAuthId: ps.deviceAuthId,
                userCode: ps.userCode,
                agentId: this.agentId
              })
            });
            var data = await resp.json();

            if (data.status === 'success') {
              clearInterval(this.deviceCodePollTimer);
              this.deviceCodePollTimer = null;
              ps.showDeviceCode = false;
              ps.showAuthFlow = false;

              // If this is a pending add flow, show success then install
              if (this.pendingProvider && this.pendingProvider.id === provider) {
                this.pendingProvider = Object.assign({}, this.pendingProvider, { success: true });
                var self = this;
                setTimeout(async function() {
                  self.pendingProvider = null;
                  await self.installAndReload(provider, 'Provider added and connected!');
                }, 800);
                return;
              }

              this.updateProviderStatus(provider, true, true, false);
              this.successMsg = 'Connected to ' + (this.PROVIDERS[provider]?.name || provider) + '!';
            } else if (data.error) {
              clearInterval(this.deviceCodePollTimer);
              this.deviceCodePollTimer = null;
              ps.pollStatus = 'Error: ' + data.error;
            }
          } catch (e) {
            console.error('Poll error:', e);
          }
        },

        async disconnectProvider(provider, profileId) {
          var info = this.PROVIDERS[provider];
          var name = info?.name || provider;
          if (!confirm('Disconnect from ' + name + '?')) return;

          var body = { agentId: this.agentId };
          if (profileId) body.profileId = profileId;

          // All providers have /logout on their auth app; try that first, fall back to OAuth route
          var resp = await fetch('/api/v1/auth/' + provider + '/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!resp.ok && info?.authType === 'oauth') {
            await fetch('/api/v1/oauth/providers/' + provider + '/logout?token=' + encodeURIComponent(this.token), { method: 'POST' });
          }
          // Reset auth flow state
          var ps = this.providerState[provider];
          if (ps) {
            ps.showAuthFlow = false;
            ps.showCodeInput = false;
            ps.showDeviceCode = false;
            ps.showApiKeyInput = false;
          }
          this.checkProviders();
        },

        // === GitHub App ===
        async initGitHubUser() {
          try {
            var resp = await fetch(this.apiUrl('/config'));
            var data = await resp.json();

            this.githubUserLoading = false;

            if (!this.githubOAuthConfigured) {
              this.initGitHub();
              return;
            }

            var githubUser = data.github?.user;
            if (githubUser) {
              this.githubUser = githubUser;
              this.initGitHub();
            }
            // else: show connect button (handled by x-show)
          } catch (e) {
            console.error('Failed to check GitHub user:', e);
            this.githubUserLoading = false;
          }
        },

        async disconnectGitHub() {
          if (!confirm('Disconnect your GitHub account?')) return;

          try {
            var resp = await fetch('/api/v1/oauth/github/logout?token=' + encodeURIComponent(this.token), {
              method: 'POST'
            });

            if (resp.ok) {
              this.githubUser = null;
              this.gitLoading = false;
              this.showInstallPrompt = false;
              this.showRepoSelection = false;
              this.successMsg = 'GitHub disconnected';
            }
          } catch (e) {
            console.error('Failed to disconnect GitHub:', e);
          }
        },

        async initGitHub() {
          this.gitLoading = true;

          try {
            var resp = await fetch(this.apiUrl('/config'));
            var data = await resp.json();

            if (!data.github?.configured) {
              this.gitLoading = false;
              return;
            }

            this.githubInstallations = data.github?.installations || [];

            if (this.githubInstallations.length === 0) {
              this.gitLoading = false;
              this.showInstallPrompt = true;
              return;
            }

            // Check if there's a saved repo URL and try to pre-select
            var savedRepoUrl = this.repoUrlValue;
            if (savedRepoUrl) {
              await this.preselectFromRepoUrl(savedRepoUrl);
            }

            this.gitLoading = false;
            this.showRepoSelection = true;

          } catch (e) {
            console.error('Failed to init GitHub:', e);
            this.gitLoading = false;
          }
        },

        async preselectFromRepoUrl(repoUrl) {
          var match = repoUrl.match(/github\\.com\\/([^\\/]+)\\/([^\\/]+)/);
          if (!match) return;

          var owner = match[1];
          var repo = match[2];
          var savedBranch = ${JSON.stringify(s.gitConfig?.branch || "")};

          var installation = this.githubInstallations.find(function(i) {
            return i.account.toLowerCase() === owner.toLowerCase();
          });
          if (!installation) return;

          this.selectedOrg = installation.id;
          await this.onOrgChange(installation.id);

          // Select the repo
          var foundRepo = this.repoOptions.find(function(r) {
            return r.fullName.toLowerCase() === (owner + '/' + repo).toLowerCase();
          });
          if (foundRepo) {
            this.selectedRepo = foundRepo.name;
            await this.fetchBranches(foundRepo.owner, foundRepo.name, foundRepo.defaultBranch);
          }

          if (savedBranch) {
            this.selectedBranch = savedBranch;
          }
        },

        async onOrgChange(installationId) {
          this.selectedRepo = '';
          this.selectedBranch = '';
          this.repoOptions = [];
          this.branchOptions = [];
          this.repoUrlValue = '';

          if (!installationId) {
            this.selectedOrg = '';
            return;
          }

          this.selectedOrg = installationId;
          this.currentInstallationId = installationId;

          try {
            var resp = await fetch('/api/v1/github/repos?token=' + encodeURIComponent(this.token) + '&installation_id=' + installationId);
            var data = await resp.json();

            this.githubRepos[installationId] = data.repos || [];
            this.repoOptions = data.repos || [];
          } catch (e) {
            console.error('Failed to fetch repos:', e);
            this.repoOptions = [];
          }
        },

        async onRepoChange(target) {
          var repoName = target.value;
          this.branchOptions = [];
          this.selectedBranch = '';

          if (!repoName) {
            this.selectedRepo = '';
            this.repoUrlValue = '';
            return;
          }

          var selectedOpt = target.selectedOptions?.[0];
          var owner = selectedOpt?.dataset?.owner || '';
          var fullName = selectedOpt?.dataset?.fullName || '';
          var defaultBranch = selectedOpt?.dataset?.defaultBranch || 'main';

          this.selectedRepo = repoName;
          this.repoUrlValue = 'https://github.com/' + fullName;

          await this.fetchBranches(owner, repoName, defaultBranch);
        },

        async fetchBranches(owner, repoName, defaultBranch) {
          try {
            var resp = await fetch('/api/v1/github/branches?token=' + encodeURIComponent(this.token) + '&owner=' + owner + '&repo=' + repoName + '&installation_id=' + this.currentInstallationId);
            var data = await resp.json();

            this.branchOptions = (data.branches || []).map(function(b) {
              return {
                name: b.name,
                protected: b.protected,
                isDefault: b.name === defaultBranch
              };
            });
            this.selectedBranch = defaultBranch;
          } catch (e) {
            console.error('Failed to fetch branches:', e);
            this.branchOptions = [];
          }
        },

        onBranchChange(value) {
          this.selectedBranch = value;
        },

        async refreshGitHub() {
          this.gitLoading = true;
          this.showInstallPrompt = false;
          this.showRepoSelection = false;
          await this.initGitHub();
        },

        // === Integrations (Skills + MCPs) ===
        async initIntegrations() {
          try {
            var resp = await fetch('/api/v1/integrations/registry?token=' + encodeURIComponent(this.token));
            var data = await resp.json();
            this.curatedSkills = data.skills || [];
            this.curatedMcps = data.mcps || [];
          } catch (e) {
            console.error('Failed to load curated integrations:', e);
          }
        },

        async addSkillFromChip(repo) {
          if (this.skills.some(function(s) { return s.repo === repo; })) return;
          await this.addSkill(repo);
        },

        async addSkill(repo) {
          if (!repo) return;
          this.skillsLoading = true;
          this.skillsError = '';

          try {
            var fetchResp = await fetch('/api/v1/integrations/skills/fetch?token=' + encodeURIComponent(this.token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo: repo })
            });

            var fetchResult = await fetchResp.json();
            if (!fetchResp.ok) {
              throw new Error(fetchResult.error || 'Failed to fetch skill');
            }

            var newSkill = {
              repo: fetchResult.repo,
              name: fetchResult.name,
              description: fetchResult.description,
              enabled: true,
              content: fetchResult.content,
              contentFetchedAt: fetchResult.fetchedAt
            };

            var updatedSkills = this.skills.concat([newSkill]);

            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
            });

            if (resp.ok) {
              this.skills = updatedSkills;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to add skill');
            }
          } catch (e) {
            this.showSkillsError(e.message);
          } finally {
            this.skillsLoading = false;
          }
        },

        async toggleSkill(repo) {
          var skill = this.skills.find(function(s) { return s.repo === repo; });
          if (!skill) return;

          var newEnabled = !skill.enabled;
          var updatedSkills = this.skills.map(function(s) {
            if (s.repo === repo) {
              var copy = {};
              for (var k in s) copy[k] = s[k];
              copy.enabled = newEnabled;
              return copy;
            }
            return s;
          });

          try {
            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
            });

            if (resp.ok) {
              this.skills = updatedSkills;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to toggle skill');
            }
          } catch (e) {
            this.showSkillsError(e.message);
          }
        },

        async removeSkill(repo) {
          if (!confirm('Remove this skill?')) return;

          var updatedSkills = this.skills.filter(function(s) { return s.repo !== repo; });

          try {
            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
            });

            if (resp.ok) {
              this.skills = updatedSkills;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to remove skill');
            }
          } catch (e) {
            this.showSkillsError(e.message);
          }
        },

        showSkillsError(msg) {
          var self = this;
          self.skillsError = msg;
          setTimeout(function() { self.skillsError = ''; }, 5000);
        },

        // === Soul Search ===
        async searchSouls() {
          this.soulSearchLoading = true;
          this.soulSearchVisible = true;
          this.soulSearchResults = [];

          try {
            var url = this.soulSearch.trim()
              ? 'https://wry-manatee-359.convex.site/api/v1/search?q=' + encodeURIComponent(this.soulSearch) + '&limit=8'
              : 'https://wry-manatee-359.convex.site/api/v1/souls?limit=8';
            var resp = await fetch(url);
            var data = await resp.json();

            this.soulSearchResults = this.soulSearch.trim() ? (data.results || []) : (data.items || []);
          } catch (e) {
            this.soulSearchResults = [];
          } finally {
            this.soulSearchLoading = false;
          }
        },

        async loadSoul(slug) {
          var textarea = document.getElementById('soulMd');
          this.soulSearchVisible = false;
          this.soulSearch = 'Loading ' + slug + '...';
          this.soulSearchLoading = true;

          try {
            var resp = await fetch('https://wry-manatee-359.convex.site/api/v1/souls/' + encodeURIComponent(slug) + '/file?path=SOUL.md');
            if (!resp.ok) throw new Error('Failed to fetch soul');
            var content = await resp.text();
            textarea.value = content;
            textarea.style.minHeight = '200px';
            this.soulSearch = '';
          } catch (e) {
            this.soulSearch = '';
            this.errorMsg = 'Failed to load soul: ' + slug;
            setTimeout(function() { this.errorMsg = ''; }.bind(this), 3000);
          } finally {
            this.soulSearchLoading = false;
          }
        },

        // === MCPs ===

        // === Unified Integration Search ===
        async searchIntegrations() {
          var q = this.integrationSearch.trim();
          if (!q) {
            this.integrationSearchVisible = false;
            this.integrationSearchResults = [];
            return;
          }

          // Auto-detect URL — add as MCP directly
          if (q.startsWith('http://') || q.startsWith('https://') || q.includes('://')) {
            var id = this.mcpIdFromUrl(q);
            await this.addMcp(id, q);
            this.integrationSearch = '';
            this.integrationSearchVisible = false;
            this.integrationSearchResults = [];
            return;
          }

          this.integrationSearchVisible = true;
          this.integrationSearchResults = [];

          try {
            var resp = await fetch('/api/v1/integrations/registry?token=' + encodeURIComponent(this.token) + '&q=' + encodeURIComponent(q));
            var data = await resp.json();
            var skillResults = (data.skills || []).map(function(s) {
              return { id: s.id, name: s.name, description: s.description, installs: s.installs, type: 'skill' };
            });
            var mcpResults = (data.mcps || []).map(function(m) {
              return { id: m.id, name: m.name, description: m.description, type: 'mcp' };
            });
            this.integrationSearchResults = skillResults.concat(mcpResults);
          } catch (e) {
            this.integrationSearchResults = [];
          }
        },

        isIntegrationAdded(result) {
          if (result.type === 'skill') {
            return this.skills.some(function(sk) { return sk.repo === result.id; });
          }
          return this.mcpServers.hasOwnProperty(result.id);
        },

        async addIntegrationFromSearch(result) {
          if (this.isIntegrationAdded(result)) return;
          if (result.type === 'skill') {
            await this.addSkill(result.id);
          } else {
            await this.addMcp(result.id, null);
          }
          this.integrationSearch = '';
          this.integrationSearchVisible = false;
          this.integrationSearchResults = [];
        },

        async addMcpFromChip(mcpId) {
          if (this.mcpServers.hasOwnProperty(mcpId)) return;
          await this.addMcp(mcpId, null);
        },

        async addMcp(mcpId, customUrl) {
          this.mcpsLoading = true;
          this.mcpsError = '';

          try {
            var mcpConfig = { enabled: true };
            if (customUrl) mcpConfig.url = customUrl;

            var updatedMcpServers = {};
            for (var k in this.mcpServers) updatedMcpServers[k] = this.mcpServers[k];
            updatedMcpServers[mcpId] = mcpConfig;

            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mcpServers: updatedMcpServers })
            });

            if (resp.ok) {
              this.mcpServers = updatedMcpServers;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to add MCP');
            }
          } catch (e) {
            this.showMcpsError(e.message);
          } finally {
            this.mcpsLoading = false;
          }
        },

        async toggleMcp(mcpId) {
          var config = this.mcpServers[mcpId];
          if (!config) return;

          var newEnabled = config.enabled === false;
          var updatedMcpServers = {};
          for (var k in this.mcpServers) updatedMcpServers[k] = this.mcpServers[k];
          var configCopy = {};
          for (var ck in config) configCopy[ck] = config[ck];
          configCopy.enabled = newEnabled;
          updatedMcpServers[mcpId] = configCopy;

          try {
            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mcpServers: updatedMcpServers })
            });

            if (resp.ok) {
              this.mcpServers = updatedMcpServers;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to toggle MCP');
            }
          } catch (e) {
            this.showMcpsError(e.message);
          }
        },

        async removeMcp(mcpId) {
          if (!confirm('Remove this MCP server?')) return;

          var updatedMcpServers = {};
          for (var k in this.mcpServers) {
            if (k !== mcpId) updatedMcpServers[k] = this.mcpServers[k];
          }

          try {
            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mcpServers: updatedMcpServers })
            });

            if (resp.ok) {
              this.mcpServers = updatedMcpServers;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to remove MCP');
            }
          } catch (e) {
            this.showMcpsError(e.message);
          }
        },

        showMcpsError(msg) {
          var self = this;
          self.mcpsError = msg;
          setTimeout(function() { self.mcpsError = ''; }, 5000);
        },

        // === Schedules ===
        async initSchedules() {
          this.schedulesLoading = true;

          try {
            var resp = await fetch(this.apiUrl('/schedules'));
            var data = await resp.json();

            if (!resp.ok) {
              throw new Error(data.error || 'Failed to load schedules');
            }

            this.schedules = data.schedules || [];
          } catch (e) {
            console.error('Failed to load schedules:', e);
            this.schedulesError = 'Failed to load scheduled reminders.';
          } finally {
            this.schedulesLoading = false;
          }
        },

        async cancelSchedule(scheduleId) {
          if (!confirm('Cancel this scheduled reminder?')) return;

          this.schedulesLoading = true;

          try {
            var resp = await fetch('/api/v1/agents/' + encodeURIComponent(this.agentId) + '/schedules/' + encodeURIComponent(scheduleId) + '?token=' + encodeURIComponent(this.token), {
              method: 'DELETE'
            });

            var result = await resp.json();

            if (resp.ok) {
              this.schedules = this.schedules.filter(function(s) { return s.scheduleId !== scheduleId; });
              this.successMsg = 'Reminder cancelled!';
            } else {
              throw new Error(result.error || 'Failed to cancel reminder');
            }
          } catch (e) {
            this.showSchedulesError(e.message);
          } finally {
            this.schedulesLoading = false;
          }
        },

        showSchedulesError(msg) {
          var self = this;
          self.schedulesError = msg;
          setTimeout(function() { self.schedulesError = ''; }, 5000);
        },

        // === Prefill Skills/MCPs ===
        async addPrefillSkill(index) {
          var skill = this.prefillSkills[index];
          if (!skill) return;

          try {
            var fetchResp = await fetch('/api/v1/integrations/skills/fetch?token=' + encodeURIComponent(this.token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo: skill.repo })
            });

            var fetchResult = await fetchResp.json();
            if (!fetchResp.ok) {
              throw new Error(fetchResult.error || 'Failed to fetch skill');
            }

            var newSkill = {
              repo: fetchResult.repo,
              name: fetchResult.name || skill.name,
              description: fetchResult.description || skill.description,
              enabled: true,
              content: fetchResult.content,
              contentFetchedAt: fetchResult.fetchedAt
            };

            var updatedSkills = this.skills.concat([newSkill]);

            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
            });

            if (resp.ok) {
              this.skills = updatedSkills;
              this.successMsg = 'Skill "' + (skill.name || skill.repo) + '" added!';
              return true;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to add skill');
            }
          } catch (e) {
            this.errorMsg = 'Error: ' + e.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return false;
          }
        },

        async addPrefillMcp(index) {
          var mcp = this.prefillMcpServers[index];
          if (!mcp) return;

          try {
            var getResp = await fetch(this.apiUrl('/config'));
            var currentConfig = await getResp.json();
            var currentMcpServersData = currentConfig.settings?.mcpServers || {};

            var mcpConfig = {};
            if (mcp.url) mcpConfig.url = mcp.url;
            if (mcp.type) mcpConfig.type = mcp.type;
            if (mcp.command) mcpConfig.command = mcp.command;
            if (mcp.args) mcpConfig.args = mcp.args;
            if (mcp.name) mcpConfig.description = mcp.name;

            var updatedMcpServers = {};
            for (var k in currentMcpServersData) updatedMcpServers[k] = currentMcpServersData[k];
            updatedMcpServers[mcp.id] = mcpConfig;

            // If MCP requires env vars, add them
            if (mcp.envVars && mcp.envVars.length > 0) {
              var currentEnvVars = currentConfig.settings?.envVars || {};
              var envVarsTextarea = document.getElementById('envVars');
              var currentText = envVarsTextarea.value;

              var newText = currentText;
              for (var i = 0; i < mcp.envVars.length; i++) {
                var envVar = mcp.envVars[i];
                if (!currentEnvVars[envVar] && currentText.indexOf(envVar + '=') === -1) {
                  newText = newText.trim() + (newText.trim() ? '\\n' : '') + envVar + '=';
                }
              }
              envVarsTextarea.value = newText;
            }

            var resp = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mcpServers: updatedMcpServers })
            });

            if (resp.ok) {
              var mcpName = mcp.name || mcp.id;
              var msg = 'MCP server "' + mcpName + '" added!';
              if (mcp.envVars && mcp.envVars.length > 0) {
                msg += ' Please fill in the required environment variables below.';
              }
              this.successMsg = msg;
              return true;
            } else {
              var result = await resp.json();
              throw new Error(result.error || 'Failed to add MCP server');
            }
          } catch (e) {
            this.errorMsg = 'Error: ' + e.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return false;
          }
        },

        // === Approve All Prefills ===
        async approveAllPrefills() {
          this.approvingPrefills = true;
          this.errorMsg = '';
          this.successMsg = '';
          var hasEnvVars = this.prefillEnvVars.length > 0;

          try {
            // 1. Merge domains and packages into existing values and PATCH
            var patchPayload = {};
            if (this.prefillAllowedDomains.length > 0) {
              var domainsEl = document.getElementById('allowedDomains');
              var existingDomains = this.parseLines(domainsEl.value);
              var mergedDomains = existingDomains.slice();
              for (var d = 0; d < this.prefillAllowedDomains.length; d++) {
                if (mergedDomains.indexOf(this.prefillAllowedDomains[d]) === -1) {
                  mergedDomains.push(this.prefillAllowedDomains[d]);
                }
              }
              domainsEl.value = mergedDomains.join('\\n');
              patchPayload.networkConfig = { allowedDomains: mergedDomains };
              // Preserve denied domains
              var deniedEl = document.getElementById('deniedDomains');
              var denied = this.parseLines(deniedEl.value);
              if (denied.length) patchPayload.networkConfig.deniedDomains = denied;
            }

            if (this.prefillNixPackages.length > 0) {
              var pkgsEl = document.getElementById('nixPackages');
              var existingPkgs = this.parseLines(pkgsEl.value);
              var mergedPkgs = existingPkgs.slice();
              for (var p = 0; p < this.prefillNixPackages.length; p++) {
                if (mergedPkgs.indexOf(this.prefillNixPackages[p]) === -1) {
                  mergedPkgs.push(this.prefillNixPackages[p]);
                }
              }
              pkgsEl.value = mergedPkgs.join('\\n');
              patchPayload.nixConfig = { packages: mergedPkgs };
            }

            // Save domains/packages if any
            if (patchPayload.networkConfig || patchPayload.nixConfig) {
              var cfgResp = await fetch(this.apiUrl('/config'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchPayload)
              });
              if (!cfgResp.ok) {
                var cfgErr = await cfgResp.json();
                throw new Error(cfgErr.error || 'Failed to save network/package config');
              }
            }

            // 2. Add prefill skills (skip already installed)
            var failures = [];
            for (var si = 0; si < this.prefillSkills.length; si++) {
              var skill = this.prefillSkills[si];
              var alreadyInstalled = false;
              for (var j = 0; j < this.skills.length; j++) {
                if (this.skills[j].repo === skill.repo) { alreadyInstalled = true; break; }
              }
              if (!alreadyInstalled) {
                // Suppress per-item messages during batch
                this.successMsg = '';
                this.errorMsg = '';
                var ok = await this.addPrefillSkill(si);
                if (!ok) failures.push(skill.name || skill.repo);
              }
            }

            // 3. Add prefill MCPs (skip already installed)
            for (var mi = 0; mi < this.prefillMcpServers.length; mi++) {
              var mcp = this.prefillMcpServers[mi];
              if (!this.mcpServers[mcp.id]) {
                this.successMsg = '';
                this.errorMsg = '';
                var ok2 = await this.addPrefillMcp(mi);
                if (!ok2) failures.push(mcp.name || mcp.id);
              }
            }

            // 4. Handle env vars — add keys to textarea, expand sections
            if (hasEnvVars) {
              var envEl = document.getElementById('envVars');
              var currentText = envEl.value;
              for (var ei = 0; ei < this.prefillEnvVars.length; ei++) {
                var envKey = this.prefillEnvVars[ei];
                if (currentText.indexOf(envKey + '=') === -1) {
                  currentText = currentText.trim() + (currentText.trim() ? '\\n' : '') + envKey + '=';
                }
              }
              envEl.value = currentText;
              this.advancedOpen = true;
              this.envVarsOpen = true;
            }

            // 5. Dismiss banner and show result
            this.prefillBannerDismissed = true;
            this.errorMsg = '';
            if (failures.length > 0) {
              this.errorMsg = 'Some items failed to add: ' + failures.join(', ');
            }
            if (hasEnvVars) {
              this.successMsg = 'Changes approved! Please fill in environment variable values below, then Save Settings.';
            } else {
              this.successMsg = failures.length > 0 ? 'Changes partially applied.' : 'All changes approved and saved!';
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (e) {
            this.errorMsg = 'Error approving changes: ' + e.message;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } finally {
            this.approvingPrefills = false;
          }
        }
      };
    }
  </script>
</body>
</html>`;
}

/**
 * Render the agent picker / creation page.
 * Shown when a channel-based token has no agent bound.
 */
export function renderPickerPage(
  payload: SettingsTokenPayload,
  agents: (AgentMetadata & { channelCount: number })[],
  token: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configure Agent - Lobu</title>
  <style>${settingsPageCSS}</style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div class="text-center mb-5">
      <div class="text-4xl mb-1">&#129438;</div>
      <h1 class="text-xl font-bold text-slate-900">Configure Agent</h1>
      <p class="text-xs text-gray-500">${getPlatformDisplay(payload.platform).icon} ${escapeHtml(formatUserId(payload.userId))}</p>
      ${payload.channelId ? `<p class="text-xs text-gray-400 mt-1">Channel: ${escapeHtml(payload.channelId)}</p>` : ""}
    </div>

    <div id="success-msg" class="hidden bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>
    <div id="error-msg" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>

    ${
      agents.length > 0
        ? `<!-- Existing Agents -->
    <div class="mb-4">
      <h2 class="text-sm font-medium text-gray-800 mb-2">Your Agents</h2>
      <div class="space-y-2" id="agents-list">
${agents
  .map(
    (agent) => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-800">${escapeHtml(agent.name)}${agent.isWorkspaceAgent ? ' <span class="text-xs text-slate-600">(workspace)</span>' : ""}</p>
            <p class="text-xs text-gray-500">${escapeHtml(agent.agentId)} &middot; ${agent.channelCount} channel${agent.channelCount !== 1 ? "s" : ""}</p>
            ${agent.description ? `<p class="text-xs text-gray-400 truncate">${escapeHtml(agent.description)}</p>` : ""}
          </div>
          <button type="button" onclick="selectAgent('${escapeHtml(agent.agentId)}')"
            class="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all flex-shrink-0">
            Select
          </button>
        </div>`
  )
  .join("")}
      </div>
    </div>`
        : `<div class="mb-4">
      <p class="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg text-center">No agents yet. Create one below to get started.</p>
    </div>`
    }

    <!-- Create New Agent -->
    <div class="border-t border-gray-200 pt-4">
      <h2 class="text-sm font-medium text-gray-800 mb-3">Create New Agent</h2>
      <div class="space-y-2">
        <div>
          <label for="agentName" class="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input type="text" id="agentName" placeholder="My Agent" maxlength="100"
            oninput="autoGenerateId()"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        </div>
        <div>
          <label for="agentId" class="block text-xs font-medium text-gray-600 mb-1">Agent ID</label>
          <input type="text" id="agentId" placeholder="my-agent" pattern="[a-z][a-z0-9-]*" minlength="3" maxlength="40"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          <p class="text-xs text-gray-400 mt-1">Auto-generated from name. Lowercase letters, numbers, hyphens.</p>
        </div>
        <button type="button" id="create-btn" onclick="createAgent()"
          class="w-full py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all">
          Create Agent
        </button>
      </div>
    </div>
  </div>

  <script>
    var token = ${JSON.stringify(token)};
    var idManuallyEdited = false;

    document.getElementById('agentId').addEventListener('input', function() {
      idManuallyEdited = true;
    });

    function autoGenerateId() {
      if (idManuallyEdited) return;
      var name = document.getElementById('agentName').value;
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug.length > 40) slug = slug.substring(0, 40);
      document.getElementById('agentId').value = slug;
    }

    async function selectAgent(agentId) {
      hideMessages();
      try {
        var resp = await fetch('/settings/switch-agent?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agentId })
        });
        var result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent selected! Loading settings...');
          setTimeout(function() { window.location.reload(); }, 500);
        } else {
          showError(result.error || 'Failed to select agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      }
    }

    async function createAgent() {
      var agentId = document.getElementById('agentId').value.trim();
      var name = document.getElementById('agentName').value.trim();

      if (!name) {
        showError('Agent name is required.');
        return;
      }
      if (!agentId) {
        showError('Agent ID is required.');
        return;
      }

      var btn = document.getElementById('create-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      hideMessages();

      try {
        var resp = await fetch('/settings/create-agent?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agentId, name: name })
        });
        var result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent created! Loading settings...');
          setTimeout(function() { window.location.reload(); }, 500);
        } else {
          showError(result.error || 'Failed to create agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Agent';
      }
    }

    function showSuccess(msg) {
      var el = document.getElementById('success-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function showError(msg) {
      var el = document.getElementById('error-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function hideMessages() {
      document.getElementById('success-msg').classList.add('hidden');
      document.getElementById('error-msg').classList.add('hidden');
    }
  </script>
</body>
</html>`;
}

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings Error - Lobu</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(to bottom right, #ef4444, #b91c1c); }
    .card { background: #fff; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); padding: 2.5rem; max-width: 28rem; width: 100%; text-align: center; }
    .icon { font-size: 3.75rem; margin-bottom: 1.25rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #dc2626; margin: 0 0 1rem 0; }
    p { color: #4b5563; margin: 0 0 1.25rem 0; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #b91c1c; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10060;</div>
    <h1>Settings Error</h1>
    <p>Unable to load settings page.</p>
    <div class="error-box">
      ${escapeHtml(message)}
    </div>
  </div>
</body>
</html>`;
}
