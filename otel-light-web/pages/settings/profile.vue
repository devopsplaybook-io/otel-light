<template>
  <div class="user-page">
    <!-- NOT AUTHENTICATED: Login Section -->
    <article v-if="!authenticationStore.isAuthenticated" class="profile-card">
      <h3>
        <i
          class="bi"
          :class="isInitialized ? 'bi-box-arrow-in-right' : 'bi-person-plus'"
        ></i>
        {{ isInitialized ? "Sign In" : "Create Admin Account" }}
      </h3>
      <p>
        {{
          isInitialized
            ? "Enter your credentials to access the dashboard."
            : "Set up the initial administrator account."
        }}
      </p>
      <label>
        Username
        <input
          type="text"
          v-model="user.name"
          placeholder="Enter username"
          @keyup.enter="isInitialized ? login() : saveNew()"
        />
      </label>
      <label>
        Password
        <input
          type="password"
          v-model="user.password"
          placeholder="Enter password"
          @keyup.enter="isInitialized ? login() : saveNew()"
        />
      </label>
      <div class="article-actions">
        <button v-if="isInitialized" :disabled="loggingIn" @click="login()">
          <i class="bi bi-box-arrow-in-right"></i>
          {{ loggingIn ? "Signing in…" : "Sign In" }}
        </button>
        <button v-else :disabled="loggingIn" @click="saveNew()">
          <i class="bi bi-person-plus"></i>
          {{ loggingIn ? "Creating…" : "Create" }}
        </button>
      </div>
      <LoginWithCodeCard
        v-if="isInitialized && isLoginCodeAvailable"
        :service="loginCodeService"
        variant="plain"
        :heading-level="3"
        class="profile-code-card"
        @approved="onCodeLoginApproved"
        @use-password="hideLoginCode"
      />
    </article>

    <!-- AUTHENTICATED: Profile Section -->
    <div v-else class="profile-content">
      <!-- Account Info -->
      <article class="card-account">
        <h3>
          <i class="bi bi-person-circle"></i>
          Account
        </h3>
        <p>
          Logged in as <strong>{{ authenticationStore.userName }}</strong>
          <span v-if="authenticationStore.isAdmin" class="badge badge-admin"
            >Admin</span
          >
          <span v-else class="badge badge-user">User</span>
        </p>
        <div class="article-actions">
          <button class="secondary" @click="logout()">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
        </div>
      </article>

      <!-- Change Password -->
      <article class="card-password">
        <h3>
          <i class="bi bi-key"></i>
          Change Password
        </h3>
        <p>Update your account password.</p>
        <div v-if="!isChangePasswordStarted">
          <button @click="changePasswordStart(true)">
            <i class="bi bi-pencil"></i> Change Password
          </button>
        </div>
        <div v-else>
          <label>
            Current Password
            <input
              type="password"
              v-model="user.passwordOld"
              placeholder="Enter current password"
            />
          </label>
          <label>
            New Password
            <input
              type="password"
              v-model="user.password"
              placeholder="Enter new password"
              @keyup.enter="changePassword()"
            />
          </label>
          <div class="article-actions">
            <button class="secondary" @click="changePasswordStart(false)">
              Cancel
            </button>
            <button :disabled="savingPassword" @click="changePassword()">
              <i class="bi bi-check-lg"></i>
              {{ savingPassword ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
      </article>

      <!-- API Tokens -->
      <article class="card-tokens">
        <h3>
          <i class="bi bi-shield-lock"></i>
          API Tokens
        </h3>
        <div v-if="createdApiToken">
          <p><strong>Copy your new token now, it will not be shown again:</strong></p>
          <div class="api-token-reveal">
            <code class="api-token-value">{{ createdApiToken }}</code>
            <button class="secondary" @click="copyApiToken()">
              <i
                class="bi"
                :class="copiedApiToken ? 'bi-clipboard-check' : 'bi-clipboard'"
              ></i>
              {{ copiedApiToken ? "Copied" : "Copy" }}
            </button>
          </div>
        </div>
        <div v-if="!isApiTokenCreationStarted">
          <button @click="createApiTokenStart(true)">
            <i class="bi bi-plus-lg"></i> Create Token
          </button>
        </div>
        <div v-else>
          <label>
            Token Name
            <input
              type="text"
              v-model="newApiToken.name"
              placeholder="e.g. CI pipeline"
              @keyup.enter="createApiToken()"
            />
          </label>
          <label>
            Expires In
            <select v-model.number="newApiToken.expiryDays">
              <option
                v-for="option in apiTokenExpiryOptions"
                :key="option.days"
                :value="option.days"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <div class="article-actions">
            <button class="secondary" @click="createApiTokenStart(false)">
              Cancel
            </button>
            <button :disabled="savingApiToken" @click="createApiToken()">
              <i class="bi bi-check-lg"></i>
              {{ savingApiToken ? "Creating…" : "Create" }}
            </button>
          </div>
        </div>
        <table v-if="apiTokens.length > 0" class="api-token-list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="apiToken in apiTokens" :key="apiToken.id">
              <td>{{ apiToken.name }}</td>
              <td>{{ new Date(apiToken.dateCreated).toLocaleString() }}</td>
              <td>
                {{
                  apiToken.lastUsedAt
                    ? ApiTokensFormatDate(apiToken.lastUsedAt)
                    : "Never"
                }}
              </td>
              <td>
                {{
                  apiToken.expiresAt
                    ? ApiTokensFormatDate(apiToken.expiresAt)
                    : "Never"
                }}
                <span
                  v-if="ApiTokensIsExpired(apiToken.expiresAt)"
                  class="badge badge-expired"
                  >Expired</span
                >
              </td>
              <td>
                <template v-if="pendingRevokeId === apiToken.id">
                  <button
                    class="secondary"
                    @click="revokeApiToken(apiToken.id)"
                  >
                    <i class="bi bi-check-lg"></i> Confirm
                  </button>
                  <button class="secondary" @click="pendingRevokeId = null">
                    Cancel
                  </button>
                </template>
                <button
                  v-else
                  class="secondary"
                  @click="confirmRevoke(apiToken.id)"
                >
                  <i class="bi bi-trash"></i> Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="apiTokens.length > 0" class="api-token-note">
          Last use is updated at most once per hour.
        </p>
      </article>

      <!-- Preferences -->
      <article class="card-preferences">
        <h3>
          <i class="bi bi-sliders"></i>
          Preferences
        </h3>
        <div class="preferences-grid">
          <section class="pref-section">
            <h4>Refresh</h4>
            <label for="refresh-interval">
              Auto-refresh interval (Traces and Logs):
            </label>
            <select
              id="refresh-interval"
              v-model="refreshInterval"
              @change="saveRefreshInterval"
            >
              <option
                v-for="option in refreshIntervalOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <label for="metrics-refresh-interval">
              Auto-refresh interval (Metrics):
            </label>
            <select
              id="metrics-refresh-interval"
              v-model="metricsRefreshInterval"
              @change="saveMetricsRefreshInterval"
            >
              <option
                v-for="option in metricsRefreshIntervalOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <p class="refresh-hint">
              Metric charts run one query each, so they refresh less often to
              keep a large dashboard from overloading the server. Use a card's
              refresh action to update a single chart on demand.
            </p>
          </section>

          <section class="pref-section">
            <h4>Dark Mode</h4>
            <button class="secondary" @click="toggleTheme">
              <i
                class="bi"
                :class="isDark ? 'bi-sun-fill' : 'bi-moon-fill'"
              ></i>
              Switch to {{ isDark ? "Light" : "Dark" }} Mode
            </button>
          </section>

          <section class="pref-section">
            <h4>Default Time Window</h4>
            <label for="default-time-traces">Traces:</label>
            <select
              id="default-time-traces"
              v-model="defaultTimeWindow.traces"
              @change="saveDefaultTimeWindow('traces')"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <label for="default-time-metrics">Metrics:</label>
            <select
              id="default-time-metrics"
              v-model="defaultTimeWindow.metrics"
              @change="saveDefaultTimeWindow('metrics')"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <label for="default-time-logs">Logs:</label>
            <select
              id="default-time-logs"
              v-model="defaultTimeWindow.logs"
              @change="saveDefaultTimeWindow('logs')"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </section>
        </div>
      </article>

      <!-- Approve a login code on another device -->
      <article v-if="isLoginCodeAvailable" class="card-device">
        <AuthorizeDeviceCard
          :service="loginCodeService"
          variant="plain"
          :heading-level="3"
          :labels="{ title: 'Log in on another device' }"
        />
      </article>
    </div>
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { markRaw } from "vue";
import { SERVER_URL } from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UserService } from "~~/services/UserService";
import {
  loginCodeService,
  loginCodesAvailable,
  setLoginCodeSessionListener,
} from "~~/services/LoginCodes";
import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";
import AuthorizeDeviceCard from "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue";
import {
  API_TOKENS_DEFAULT_EXPIRY_DAYS,
  ApiTokensExpiryIso,
  ApiTokensExpiryOptions,
  ApiTokensFormatDate,
  ApiTokensIsExpired,
} from "~~/services/ApiTokens";
import { ServicesStore } from "~~/stores/ServicesStore";
import {
  MetricsRefreshIntervalOptions,
  RefreshIntervalOptions,
  RefreshIntervalService,
} from "~~/services/RefreshIntervalService";
import {
  PreferencesService,
  TimeWindowOptions,
  getDefaultTimeWindow,
  setDefaultTimeWindow,
} from "~/services/PreferencesService";

export default {
  components: {
    LoginWithCodeCard,
    AuthorizeDeviceCard,
  },
  data() {
    return {
      user: {},
      isInitialized: true,
      isLoginCodeAvailable: false,
      loginCodeService: markRaw(loginCodeService),
      codeLoginHandled: false,
      stopLoginCodeSessionListener: null,
      isChangePasswordStarted: false,
      loggingIn: false,
      savingPassword: false,
      apiTokens: [],
      isApiTokenCreationStarted: false,
      newApiToken: { expiryDays: API_TOKENS_DEFAULT_EXPIRY_DAYS },
      apiTokenExpiryOptions: ApiTokensExpiryOptions,
      savingApiToken: false,
      createdApiToken: null,
      copiedApiToken: false,
      pendingRevokeId: null,
      isDark: PreferencesService.isDark(),
      refreshInterval: RefreshIntervalService.get(),
      metricsRefreshInterval: RefreshIntervalService.getMetrics(),
      refreshIntervalOptions: RefreshIntervalOptions,
      metricsRefreshIntervalOptions: MetricsRefreshIntervalOptions,
      defaultTimeWindow: {
        traces: getDefaultTimeWindow("traces"),
        metrics: getDefaultTimeWindow("metrics"),
        logs: getDefaultTimeWindow("logs"),
      },
      timeWindowOptions: TimeWindowOptions,
    };
  },
  async created() {
    this.stopLoginCodeSessionListener = setLoginCodeSessionListener(() =>
      this.onCodeLoginApproved(),
    );
    this.isInitialized = await UserService.isInitialized();
    this.isLoginCodeAvailable = await loginCodesAvailable();
    AuthenticationStore().isAuthenticated = await AuthService.isAuthenticated();
    if (AuthenticationStore().isAuthenticated) {
      await AuthenticationStore().refreshFromToken();
      this.listApiTokens();
    }
    this.refreshInterval = RefreshIntervalService.get();
    this.metricsRefreshInterval = RefreshIntervalService.getMetrics();
    this.defaultTimeWindow.traces = getDefaultTimeWindow("traces");
    this.defaultTimeWindow.metrics = getDefaultTimeWindow("metrics");
    this.defaultTimeWindow.logs = getDefaultTimeWindow("logs");
  },
  beforeUnmount() {
    this.stopLoginCodeSessionListener?.();
  },
  methods: {
    ApiTokensFormatDate,
    ApiTokensIsExpired,
    async saveNew() {
      if (this.user.name && this.user.password) {
        this.loggingIn = true;
        try {
          await UserService.register(this.user.name, this.user.password);
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "User created",
          });
          this.isInitialized = true;
          await this.login();
        } catch (err) {
          handleError(err);
        } finally {
          this.loggingIn = false;
        }
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Username or password missing",
        });
      }
    },
    async login() {
      if (this.user.name && this.user.password) {
        this.loggingIn = true;
        try {
          const res = await UserService.login(
            this.user.name,
            this.user.password,
          );
          AuthService.saveToken(res.data.token);
          await AuthenticationStore().refreshFromToken();
          // Account switch: never show the previous user's cached service list.
          ServicesStore().clear();
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "User Logged In",
          });
          useRouter().push({ path: "/" });
        } catch (err) {
          handleError(err);
        } finally {
          this.loggingIn = false;
        }
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Username or password missing",
        });
      }
    },
    async changePassword() {
      if (this.user.password && this.user.passwordOld) {
        this.savingPassword = true;
        try {
          await axios.put(
            `${SERVER_URL}/users/password`,
            this.user,
            await AuthService.getAuthHeader(),
          );
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Password Changed",
          });
          this.isChangePasswordStarted = false;
          this.user = {};
        } catch (err) {
          handleError(err);
        } finally {
          this.savingPassword = false;
        }
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Password missing",
        });
      }
    },
    async logout() {
      AuthenticationStore().signOut();
      useRouter().push({ path: "/settings/profile" });
    },
    onCodeLoginApproved() {
      if (this.codeLoginHandled) return;
      this.codeLoginHandled = true;
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: "User Logged In",
      });
      useRouter().push({ path: "/" });
    },
    hideLoginCode() {
      this.isLoginCodeAvailable = false;
    },
    changePasswordStart(enable) {
      this.isChangePasswordStarted = enable;
      this.user = {};
    },
    async listApiTokens() {
      try {
        this.apiTokens = (await UserService.listApiTokens()).data;
        this.pendingRevokeId = null;
      } catch (err) {
        handleError(err);
      }
    },
    createApiTokenStart(enable) {
      this.isApiTokenCreationStarted = enable;
      this.newApiToken = { expiryDays: API_TOKENS_DEFAULT_EXPIRY_DAYS };
      if (!enable) {
        this.createdApiToken = null;
        this.copiedApiToken = false;
      }
    },
    async createApiToken() {
      if (!this.newApiToken.name) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Token name missing",
        });
        return;
      }
      const expiresAt = ApiTokensExpiryIso(this.newApiToken.expiryDays);
      if (!expiresAt) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Select a token expiry",
        });
        return;
      }
      this.savingApiToken = true;
      try {
        const res = await UserService.createApiToken(
          this.newApiToken.name,
          expiresAt,
        );
        this.createdApiToken = res.data.token;
        this.copiedApiToken = false;
        this.newApiToken = { expiryDays: API_TOKENS_DEFAULT_EXPIRY_DAYS };
        this.isApiTokenCreationStarted = false;
        await this.listApiTokens();
      } catch (err) {
        handleError(err);
      } finally {
        this.savingApiToken = false;
      }
    },
    async copyApiToken() {
      try {
        await navigator.clipboard.writeText(this.createdApiToken);
        this.copiedApiToken = true;
      } catch (err) {
        handleError(err);
      }
    },
    confirmRevoke(id) {
      this.pendingRevokeId = id;
    },
    async revokeApiToken(id) {
      try {
        await UserService.deleteApiToken(id);
        this.pendingRevokeId = null;
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "API Token Revoked",
        });
        await this.listApiTokens();
      } catch (err) {
        handleError(err);
      }
    },
    saveRefreshInterval() {
      RefreshIntervalService.set(this.refreshInterval);
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: `Auto-refresh interval set to ${this.intervalLabel(
          this.refreshIntervalOptions,
          this.refreshInterval,
        )}`,
      });
    },
    saveMetricsRefreshInterval() {
      RefreshIntervalService.setMetrics(this.metricsRefreshInterval);
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: `Metrics refresh interval set to ${this.intervalLabel(
          this.metricsRefreshIntervalOptions,
          this.metricsRefreshInterval,
        )}`,
      });
    },
    intervalLabel(options, val) {
      const option = options.find((item) => item.value === String(val));
      return option ? option.label : `${val} ms`;
    },
    toggleTheme() {
      PreferencesService.toggleTheme(this);
    },
    saveDefaultTimeWindow(type) {
      setDefaultTimeWindow(type, this.defaultTimeWindow[type]);
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: `Default time window for ${type} set to ${this.getTimeWindowLabel(
          this.defaultTimeWindow[type],
        )}`,
      });
    },
    getTimeWindowLabel(val) {
      const opt = this.timeWindowOptions.find((o) => o.value === Number(val));
      return opt ? opt.label : `${val} seconds ago`;
    },
  },
};
</script>

<style scoped>
.user-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding-top: 1rem;
  width: 100%;
}

.profile-card {
  max-width: 480px;
  width: 100%;
}

/* Responsive card grid: a single column on narrow screens, two columns on
   tablet-sized layouts and three on large desktop layouts, so the settings
   page uses the available width instead of a narrow centered strip. */
.profile-content {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  align-items: start;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "account"
    "password"
    "tokens"
    "preferences"
    "device";
}

.profile-content > article {
  margin-bottom: 0;
}

.card-account {
  grid-area: account;
}

.card-password {
  grid-area: password;
}

.card-tokens {
  grid-area: tokens;
}

.card-preferences {
  grid-area: preferences;
}

.card-device {
  grid-area: device;
}

/* Preferences is the tallest card; spanning the full width and flowing its
   sections into their own columns keeps it from leaving a large empty area
   next to the shorter cards. */
.preferences-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem 1.5rem;
  margin-top: 0.5rem;
}

@media (min-width: 700px) {
  .preferences-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
}

.pref-section h4 {
  margin: 0 0 0.5em;
  font-size: 0.95em;
}

.pref-section label {
  margin-top: 0.25rem;
}

@media (min-width: 860px) {
  .profile-content {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas:
      "account password"
      "tokens tokens"
      "preferences preferences"
      "device device";
  }
}

@media (min-width: 1400px) {
  .profile-content {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-areas:
      "account password tokens"
      "preferences preferences preferences"
      "device device device";
  }
}

.profile-code-card {
  margin-top: 1rem;
}

.badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 0.1em 0.5em;
  border-radius: var(--pico-border-radius);
  margin-left: 0.5em;
  vertical-align: middle;
  font-weight: 600;
}

.badge-admin {
  color: var(--pico-del-color);
  background: color-mix(in srgb, var(--pico-del-color) 15%, transparent);
}

.badge-user {
  color: var(--pico-ins-color);
  background: color-mix(in srgb, var(--pico-ins-color) 15%, transparent);
}

h4 {
  font-size: 0.95em;
}

.article-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}

.api-token-reveal {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.api-token-value {
  word-break: break-all;
}

.api-token-list {
  margin-top: 1rem;
  display: block;
  overflow-x: auto;
  white-space: nowrap;
}

.api-token-list td:last-child,
.api-token-list th:last-child {
  text-align: right;
}

.api-token-list td:last-child button {
  margin: 0 0 0 0.35rem;
  width: auto;
  font-size: 0.8rem;
}

.api-token-note {
  margin-top: 0.5rem;
  font-size: 0.8em;
  opacity: 0.65;
}

.refresh-hint {
  margin-top: 0.5rem;
  font-size: 0.8em;
  opacity: 0.65;
}

.badge-expired {
  color: var(--pico-del-color);
  background: color-mix(in srgb, var(--pico-del-color) 15%, transparent);
}
</style>
