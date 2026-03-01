/**
 * Settings Page Alpine.js Application
 *
 * Contains the settingsApp() and permissionsSection() functions
 * that power the interactive settings page.
 */

/**
 * Returns the full `<script>` block content for the settings page.
 *
 * @param initialStateJson - JSON-serialized initial state object
 * @param hasNoProviders   - true when no providers are configured (auto-opens model section)
 */
export function renderAlpineApp(
  initialStateJson: string,
  hasNoProviders: boolean
): string {
  const autoOpenModel = hasNoProviders
    ? `          // Auto-open model section when no providers configured
          if (!openParam) this.openSections.model = true;`
    : "";

  return `
  <script>
    const __STATE__ = ${initialStateJson};

    function settingsApp() {
      return {
        // Config
        agentId: __STATE__.agentId,
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
        initialSettingsSnapshot: null,
        verboseLogging: !!__STATE__.verboseLogging,
        identityMd: __STATE__.identityMd || '',
        soulMd: __STATE__.soulMd || '',
        userMd: __STATE__.userMd || '',

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

        // Skills
        skills: __STATE__.initialSkills,
        skillsLoading: false,
        skillsError: '',
        curatedSkills: [],

        // MCPs
        mcpServers: __STATE__.initialMcpServers,
        mcpsLoading: false,
        mcpsError: '',
        curatedMcps: [],

        // Secrets
        secrets: Array.isArray(__STATE__.initialSecrets)
          ? __STATE__.initialSecrets.map(function(secret, idx) {
              return {
                id: idx + 1,
                key: secret && typeof secret.key === 'string' ? secret.key : '',
                value: secret && typeof secret.value === 'string' ? secret.value : '',
                reveal: false
              };
            })
          : [],
        nextSecretId: (Array.isArray(__STATE__.initialSecrets) ? __STATE__.initialSecrets.length : 0) + 1,

        // Nix packages
        nixPackages: Array.isArray(__STATE__.initialNixPackages)
          ? __STATE__.initialNixPackages.slice()
          : [],
        nixPackageQuery: '',
        nixPackageSuggestions: [],
        nixPackageSuggestionsVisible: false,
        nixPackageSearchLoading: false,

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
        prefillGrants: __STATE__.prefillGrants,
        prefillNixPackages: __STATE__.prefillNixPackages,
        prefillEnvVars: __STATE__.prefillEnvVars,
        prefillBannerDismissed: new URL(window.location.href).searchParams.has('dismissed'),
        approvingPrefills: false,

        // Section open states (unified, persisted in URL ?open=id,id)
        openSections: {},

        get hasPrefills() {
          return !!(this.prefillGrants.length || this.prefillNixPackages.length || this.prefillEnvVars.length || this.prefillSkills.length || this.prefillMcpServers.length);
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

          var urlParams = new URLSearchParams(window.location.search);

          // Restore open accordion sections from URL
          var openParam = urlParams.get('open');
          if (openParam) {
            openParam.split(',').forEach(function(id) {
              this.openSections[id] = true;
            }.bind(this));
          }
${autoOpenModel}

          this.checkProviders();
          this.initIntegrations();
          this.initSchedules();
          this.initialSettingsSnapshot = this.buildSettingsSnapshot();
        },

        // === Section toggle + URL sync ===
        toggleSection(id) {
          this.openSections[id] = !this.openSections[id];
          this.updateSectionsUrl();
        },
        updateSectionsUrl() {
          var ids = Object.keys(this.openSections).filter(function(k) {
            return this.openSections[k];
          }.bind(this));
          var url = new URL(window.location.href);
          if (ids.length > 0) {
            url.searchParams.set('open', ids.join(','));
          } else {
            url.searchParams.delete('open');
          }
          window.history.replaceState({}, '', url.toString());
        },

        // === Helpers ===
        parseLines(text) {
          return text.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
        },

        buildCurrentEnvVars() {
          var envVars = {};
          for (var i = 0; i < this.secrets.length; i++) {
            var secret = this.secrets[i];
            var key = this.normalizeSecretKey(secret && secret.key);
            if (!key) continue;
            if (envVars[key] === undefined) {
              envVars[key] = (secret && secret.value) || '';
            }
          }
          return envVars;
        },

        envVarsSignature(envVars) {
          return Object.keys(envVars)
            .sort()
            .map(function(key) { return key + '=' + (envVars[key] || ''); })
            .join('\\n');
        },

        nixPackagesSignature() {
          return this.nixPackages
            .map(function(pkg) { return (pkg || '').trim(); })
            .filter(function(pkg) { return !!pkg; })
            .join('\\n');
        },

        buildSettingsSnapshot() {
          var envVars = this.buildCurrentEnvVars();

          return {
            identityMd: this.identityMd || '',
            soulMd: this.soulMd || '',
            userMd: this.userMd || '',
            verboseLogging: !!this.verboseLogging,
            primaryProvider: this.primaryProvider || '',
            providerOrder: this.providerOrder.join(','),
            nixPackages: this.nixPackagesSignature(),
            envVars: this.envVarsSignature(envVars)
          };
        },

        hasPendingSettingsChanges() {
          if (!this.initialSettingsSnapshot) return false;
          var current = this.buildSettingsSnapshot();
          return JSON.stringify(current) !== JSON.stringify(this.initialSettingsSnapshot);
        },

        normalizeSecretKey(key) {
          return (key || '').trim();
        },

        addSecret(key, value) {
          this.secrets = this.secrets.concat([{
            id: this.nextSecretId++,
            key: this.normalizeSecretKey(key),
            value: value || '',
            reveal: false
          }]);
        },

        removeSecret(id) {
          this.secrets = this.secrets.filter(function(secret) {
            return secret.id !== id;
          });
        },

        normalizeNixPackageName(name) {
          return (name || '').trim();
        },

        addNixPackage(name) {
          var packageName = this.normalizeNixPackageName(name);
          if (!packageName) return;
          if (this.nixPackages.indexOf(packageName) !== -1) {
            this.nixPackageQuery = '';
            this.nixPackageSuggestions = [];
            this.nixPackageSuggestionsVisible = false;
            return;
          }
          this.nixPackages = this.nixPackages.concat([packageName]);
          this.nixPackageQuery = '';
          this.nixPackageSuggestions = [];
          this.nixPackageSuggestionsVisible = false;
        },

        addNixPackageFromQuery() {
          this.addNixPackage(this.nixPackageQuery);
        },

        removeNixPackage(name) {
          this.nixPackages = this.nixPackages.filter(function(pkg) {
            return pkg !== name;
          });
        },

        async searchNixPackages() {
          var query = this.normalizeNixPackageName(this.nixPackageQuery);
          if (!query) {
            this.nixPackageSuggestionsVisible = false;
            this.nixPackageSuggestions = [];
            this.nixPackageSearchLoading = false;
            return;
          }

          this.nixPackageSuggestionsVisible = true;
          this.nixPackageSearchLoading = true;
          try {
            var response = await fetch(
              this.apiUrl('/config/packages/search') + '?q=' + encodeURIComponent(query)
            );
            var data = await response.json().catch(function() { return {}; });
            if (!response.ok) throw new Error(data.error || 'Failed to search packages');

            var suggestions = Array.isArray(data.packages) ? data.packages : [];
            var seen = {};
            var filtered = [];
            for (var i = 0; i < suggestions.length; i++) {
              var item = suggestions[i] || {};
              var name = this.normalizeNixPackageName(item.name);
              if (!name) continue;
              if (this.nixPackages.indexOf(name) !== -1) continue;
              if (seen[name]) continue;
              seen[name] = true;
              filtered.push({
                name: name,
                pname: typeof item.pname === 'string' ? item.pname : '',
                description: typeof item.description === 'string' ? item.description : ''
              });
            }
            this.nixPackageSuggestions = filtered;
          } catch (e) {
            this.nixPackageSuggestions = [];
          } finally {
            this.nixPackageSearchLoading = false;
          }
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
          return '/api/v1/agents/' + encodeURIComponent(this.agentId) + path;
        },

        async switchAgent(agentId) {
          try {
            var resp = await fetch('/settings/switch-agent', {
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

            var resp = await fetch('/settings/update-agent', {
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
            var resp = await fetch('/settings/create-agent', {
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
            var resp = await fetch('/api/v1/agent-management/agents/' + encodeURIComponent(this.agentId), {
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
          settings.identityMd = this.identityMd || '';
          settings.soulMd = this.soulMd || '';
          settings.userMd = this.userMd || '';

          // System packages
          var nixPackages = this.nixPackages
            .map(function(pkg) { return (pkg || '').trim(); })
            .filter(function(pkg) { return !!pkg; });
          if (nixPackages.length) {
            settings.nixConfig = { packages: nixPackages };
          } else {
            settings.nixConfig = null;
          }

          // Secrets
          settings.envVars = this.buildCurrentEnvVars();

          // Verbose logging
          settings.verboseLogging = !!this.verboseLogging;

          try {
            var response = await fetch(this.apiUrl('/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            });

            var result = await response.json();

            if (response.ok) {
              this.successMsg = 'Settings saved!';
              this.initialSettingsSnapshot = this.buildSettingsSnapshot();
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
            var resp = await fetch('/api/v1/oauth/providers/' + provider + '/code', {
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
            var resp = await fetch('/api/v1/auth/' + provider + '/save-key?token=' + encodeURIComponent(this.token), {
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

            var resp = await fetch('/api/v1/auth/' + provider + '/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId: this.agentId,
                token: this.token
              })
            });
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
                agentId: this.agentId,
                token: this.token
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
          var resp = await fetch('/api/v1/auth/' + provider + '/logout?token=' + encodeURIComponent(this.token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!resp.ok && info?.authType === 'oauth') {
            await fetch('/api/v1/oauth/providers/' + provider + '/logout', { method: 'POST' });
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

        // === Integrations (Skills + MCPs) ===
        async initIntegrations() {
          try {
            var resp = await fetch('/api/v1/integrations/registry');
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
            var fetchResp = await fetch('/api/v1/integrations/skills/fetch', {
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
            var resp = await fetch('/api/v1/integrations/registry?q=' + encodeURIComponent(q));
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
            var resp = await fetch('/api/v1/agents/' + encodeURIComponent(this.agentId) + '/schedules/' + encodeURIComponent(scheduleId), {
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
            var fetchResp = await fetch('/api/v1/integrations/skills/fetch', {
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
              for (var i = 0; i < mcp.envVars.length; i++) {
                var envVar = mcp.envVars[i];
                var normalizedKey = this.normalizeSecretKey(envVar);
                if (!normalizedKey) continue;
                var existsInForm = this.secrets.some(function(secret) {
                  return this.normalizeSecretKey(secret && secret.key) === normalizedKey;
                }.bind(this));
                var existsInSavedConfig = Object.prototype.hasOwnProperty.call(
                  currentEnvVars,
                  normalizedKey
                );
                if (!existsInSavedConfig && !existsInForm) {
                  this.addSecret(normalizedKey, '');
                }
              }
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
                msg += ' Please fill in the required secrets below.';
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
            // 1. Create grants for pre-filled domains
            for (var d = 0; d < this.prefillGrants.length; d++) {
              await fetch(this.apiUrl('/grants'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern: this.prefillGrants[d], expiresAt: null })
              });
            }

            // 2. Save nix packages if any
            if (this.prefillNixPackages.length > 0) {
              var mergedPkgs = this.nixPackages.slice();
              for (var p = 0; p < this.prefillNixPackages.length; p++) {
                var packageName = this.normalizeNixPackageName(this.prefillNixPackages[p]);
                if (packageName && mergedPkgs.indexOf(packageName) === -1) {
                  mergedPkgs.push(packageName);
                }
              }
              this.nixPackages = mergedPkgs;
              var nixResp = await fetch(this.apiUrl('/config'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nixConfig: { packages: mergedPkgs } })
              });
              if (!nixResp.ok) {
                var nixErr = await nixResp.json();
                throw new Error(nixErr.error || 'Failed to save package config');
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

            // 4. Handle env vars — add keys to secrets list, expand sections
            if (hasEnvVars) {
              var existingSecretKeys = {};
              for (var es = 0; es < this.secrets.length; es++) {
                var existingKey = this.normalizeSecretKey(
                  this.secrets[es] && this.secrets[es].key
                );
                if (existingKey) existingSecretKeys[existingKey] = true;
              }
              for (var ei = 0; ei < this.prefillEnvVars.length; ei++) {
                var envKey = this.normalizeSecretKey(this.prefillEnvVars[ei]);
                if (!envKey) continue;
                if (!existingSecretKeys[envKey]) {
                  this.addSecret(envKey, '');
                  existingSecretKeys[envKey] = true;
                }
              }
              this.openSections.envvars = true;
              this.updateSectionsUrl();
            }

            // 5. Dismiss banner and show result
            this.prefillBannerDismissed = true;
            this.errorMsg = '';
            if (failures.length > 0) {
              this.errorMsg = 'Some items failed to add: ' + failures.join(', ');
            }
            if (hasEnvVars) {
              // Don't persist dismissed to URL — env vars still need values + save.
              // On refresh the banner will reappear so the user can re-approve.
              this.successMsg = 'Changes approved! Please fill in secret values below, then Save Settings.';
            } else {
              var u = new URL(window.location.href); u.searchParams.set('dismissed','1'); window.history.replaceState({}, '', u.toString());
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

    function permissionsSection() {
      return {
        permissionItems: [],
        permissionsLoading: true,
        showAddForm: false,
        newPattern: '',
        newAccess: '1h',

        init() {
          this.loadPermissions();
        },

        apiUrl(path) {
          return '/api/v1/agents/' + encodeURIComponent(__STATE__.agentId) + '/config' + path;
        },

        async loadPermissions() {
          this.permissionsLoading = true;
          var items = [];

          try {
            var grantResp = await fetch(this.apiUrl('/grants'));
            if (grantResp.ok) {
              var grants = await grantResp.json();
              for (var k = 0; k < grants.length; k++) {
                var g = grants[k];
                var type = g.denied ? 'denied' : (g.expiresAt === null ? 'always' : 'grant');
                items.push({ pattern: g.pattern, type: type, expiresAt: g.expiresAt, grantedAt: g.grantedAt, denied: !!g.denied });
              }
            }
          } catch (e) { /* ignore */ }

          // Sort: domains first, then MCP tools
          items.sort(function(a, b) {
            var aIsTool = a.pattern.startsWith('/') ? 1 : 0;
            var bIsTool = b.pattern.startsWith('/') ? 1 : 0;
            if (aIsTool !== bIsTool) return aIsTool - bIsTool;
            return a.pattern.localeCompare(b.pattern);
          });

          this.permissionItems = items;
          this.permissionsLoading = false;
        },

        badgeText(item) {
          if (item.denied) return 'Denied';
          if (item.expiresAt === null) return 'Always';
          var remaining = item.expiresAt - Date.now();
          if (remaining <= 0) return 'Expired';
          if (remaining > 86400000) return Math.ceil(remaining / 86400000) + 'd left';
          if (remaining > 3600000) return Math.ceil(remaining / 3600000) + 'h left';
          return Math.ceil(remaining / 60000) + 'min left';
        },

        badgeClass(item) {
          if (item.denied) return 'bg-red-100 text-red-700';
          if (item.expiresAt === null) return 'bg-green-100 text-green-700';
          var remaining = item.expiresAt - Date.now();
          if (remaining <= 0) return 'bg-gray-100 text-gray-500';
          return 'bg-blue-100 text-blue-700';
        },

        async addPermission() {
          var pattern = this.newPattern.trim();
          if (!pattern) return;

          var expiresAt = null;
          var denied = false;
          if (this.newAccess === '1h') expiresAt = Date.now() + 3600000;
          else if (this.newAccess === 'session') expiresAt = Date.now() + 86400000;
          else if (this.newAccess === 'denied') denied = true;

          await fetch(this.apiUrl('/grants'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pattern: pattern, expiresAt: expiresAt, denied: denied || undefined })
          });

          this.newPattern = '';
          this.showAddForm = false;
          await this.loadPermissions();
        },

        async removePermission(item) {
          await fetch(this.apiUrl('/grants/' + encodeURIComponent(item.pattern)), { method: 'DELETE' });
          await this.loadPermissions();
        }
      };
    }
  </script>`;
}
