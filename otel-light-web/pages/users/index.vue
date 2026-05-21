<template>
  <div class="user-page">
    <!-- NOT AUTHENTICATED: Login Section -->
    <div v-if="!authenticationStore.isAuthenticated" class="users-card">
      <div class="users-section">
        <h3 class="section-title">
          <i class="bi bi-box-arrow-in-right"></i>
          {{ isInitialized ? "Sign In" : "Create Admin Account" }}
        </h3>
        <p class="section-desc">
          {{
            isInitialized
              ? "Enter your credentials to access the dashboard."
              : "Set up the initial administrator account."
          }}
        </p>
        <div class="field-row">
          <label class="field-label">Username</label>
          <input
            type="text"
            v-model="user.name"
            placeholder="Enter username"
            class="field-input"
            @keyup.enter="isInitialized ? login() : saveNew()"
          />
        </div>
        <div class="field-row">
          <label class="field-label">Password</label>
          <input
            type="password"
            v-model="user.password"
            placeholder="Enter password"
            class="field-input"
            @keyup.enter="isInitialized ? login() : saveNew()"
          />
        </div>
      </div>
      <div class="users-actions">
        <button
          v-if="isInitialized"
          class="btn-primary"
          :disabled="loggingIn"
          @click="login()"
        >
          <i class="bi bi-box-arrow-in-right"></i>
          {{ loggingIn ? "Signing in…" : "Sign In" }}
        </button>
        <button
          v-else
          class="btn-primary"
          :disabled="loggingIn"
          @click="saveNew()"
        >
          <i class="bi bi-person-plus"></i>
          {{ loggingIn ? "Creating…" : "Create" }}
        </button>
      </div>
    </div>

    <!-- AUTHENTICATED: Profile Section -->
    <div v-else class="profile-content">
      <!-- Account Info -->
      <div class="users-card">
        <div class="users-section">
          <h3 class="section-title">
            <i class="bi bi-person-circle"></i>
            Account
          </h3>
          <p class="section-desc">
            Logged in as <strong>{{ authenticationStore.userName }}</strong>
            <span v-if="authenticationStore.isAdmin" class="badge-admin"
              >Admin</span
            >
            <span v-else class="badge-user">User</span>
          </p>
        </div>
        <div class="users-actions">
          <button class="btn-secondary" @click="logout()">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
        </div>
      </div>

      <!-- Change Password -->
      <div class="users-card">
        <div class="users-section">
          <h3 class="section-title">
            <i class="bi bi-key"></i>
            Change Password
          </h3>
          <p class="section-desc">Update your account password.</p>
          <div v-if="!isChangePasswordStarted">
            <button class="btn-primary" @click="changePasswordStart(true)">
              <i class="bi bi-pencil"></i> Change Password
            </button>
          </div>
          <div v-else>
            <div class="field-row">
              <label class="field-label">Current Password</label>
              <input
                type="password"
                v-model="user.passwordOld"
                placeholder="Enter current password"
                class="field-input"
              />
            </div>
            <div class="field-row">
              <label class="field-label">New Password</label>
              <input
                type="password"
                v-model="user.password"
                placeholder="Enter new password"
                class="field-input"
                @keyup.enter="changePassword()"
              />
            </div>
          </div>
        </div>
        <div v-if="isChangePasswordStarted" class="users-actions">
          <button class="btn-secondary" @click="changePasswordStart(false)">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="savingPassword"
            @click="changePassword()"
          >
            <i class="bi bi-check-lg"></i>
            {{ savingPassword ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>

      <!-- Preferences -->
      <div class="users-card">
        <div class="users-section">
          <h3 class="section-title">
            <i class="bi bi-sliders"></i>
            Preferences
          </h3>
        </div>
        <div class="users-section">
          <h4>Refresh</h4>
          <div class="field-row">
            <label class="field-label" for="refresh-interval">
              Auto-refresh interval (Traces and Logs):
            </label>
            <select
              id="refresh-interval"
              v-model="refreshInterval"
              @change="saveRefreshInterval"
              class="field-input field-select"
            >
              <option value="0">No auto-refresh</option>
              <option value="5000">5 seconds</option>
              <option value="10000">10 seconds</option>
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
            </select>
          </div>

          <h4>Dark Mode</h4>
          <button
            class="btn-secondary"
            @click="toggleTheme"
            style="margin-bottom: 1em"
          >
            <i class="bi" :class="isDark ? 'bi-sun-fill' : 'bi-moon-fill'"></i>
            Switch to {{ isDark ? "Light" : "Dark" }} Mode
          </button>

          <h4>Default Time Window</h4>
          <div class="field-row">
            <label class="field-label" for="default-time-traces">Traces:</label>
            <select
              id="default-time-traces"
              v-model="defaultTimeWindow.traces"
              @change="saveDefaultTimeWindow('traces')"
              class="field-input field-select"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
          <div class="field-row">
            <label class="field-label" for="default-time-metrics"
              >Metrics:</label
            >
            <select
              id="default-time-metrics"
              v-model="defaultTimeWindow.metrics"
              @change="saveDefaultTimeWindow('metrics')"
              class="field-input field-select"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
          <div class="field-row">
            <label class="field-label" for="default-time-logs">Logs:</label>
            <select
              id="default-time-logs"
              v-model="defaultTimeWindow.logs"
              @change="saveDefaultTimeWindow('logs')"
              class="field-input field-select"
            >
              <option
                v-for="option in timeWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UserService } from "~~/services/UserService";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import {
  PreferencesService,
  TimeWindowOptions,
  getDefaultTimeWindow,
  setDefaultTimeWindow,
} from "~/services/PreferencesService";

export default {
  data() {
    let isDark = false;
    const storedTheme = localStorage.getItem("UI_THEME");
    if (storedTheme === "dark" || storedTheme === "light") {
      isDark = storedTheme === "dark";
    } else {
      isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return {
      user: {},
      isInitialized: true,
      isChangePasswordStarted: false,
      loggingIn: false,
      savingPassword: false,
      isDark,
      refreshInterval: RefreshIntervalService.get(),
      defaultTimeWindow: {
        traces: getDefaultTimeWindow("traces"),
        metrics: getDefaultTimeWindow("metrics"),
        logs: getDefaultTimeWindow("logs"),
      },
      timeWindowOptions: TimeWindowOptions,
    };
  },
  async created() {
    this.isInitialized = await UserService.isInitialized();
    AuthenticationStore().isAuthenticated = await AuthService.isAuthenticated();
    if (AuthenticationStore().isAuthenticated) {
      await AuthenticationStore().refreshFromToken();
    }
    this.refreshInterval = RefreshIntervalService.get();
    this.defaultTimeWindow.traces = getDefaultTimeWindow("traces");
    this.defaultTimeWindow.metrics = getDefaultTimeWindow("metrics");
    this.defaultTimeWindow.logs = getDefaultTimeWindow("logs");
  },
  methods: {
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
            `${(await Config.get()).SERVER_URL}/users/password`,
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
      AuthService.removeToken();
      AuthenticationStore().isAuthenticated = false;
      AuthenticationStore().role = null;
      AuthenticationStore().scopes = [];
      AuthenticationStore().userName = null;
      useRouter().push({ path: "/users" });
    },
    changePasswordStart(enable) {
      this.isChangePasswordStarted = enable;
      this.user = {};
    },
    saveRefreshInterval() {
      RefreshIntervalService.set(this.refreshInterval);
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: `Refresh interval set to ${this.getRefreshIntervalLabel(
          this.refreshInterval,
        )}`,
      });
    },
    getRefreshIntervalLabel(val) {
      switch (val) {
        case "0":
          return "No auto-refresh";
        case "5000":
          return "5 seconds";
        case "10000":
          return "10 seconds";
        case "30000":
          return "30 seconds";
        case "60000":
          return "1 minute";
        default:
          return `${val} ms`;
      }
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

.users-card {
  border: 1px solid var(--color-border, #ddd);
  border-radius: var(--radius-lg, 8px);
  background: var(--color-bg, #fff);
  max-width: 480px;
  width: 100%;
}

.users-section {
  padding: 1.2em 1.2em 0.6em;
}

.section-title {
  margin: 0 0 0.15em;
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-text);
}

.section-desc {
  margin: 0 0 1em;
  font-size: var(--font-base);
  color: var(--color-text-muted);
}

.users-actions {
  padding: 0.8em 1.2em 1.2em;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
}

.field-row {
  margin-bottom: var(--space-base, 0.8em);
}

.field-label {
  display: block;
  font-weight: 600;
  font-size: var(--font-base);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xs);
}

.field-input {
  display: block;
  width: 100%;
  padding: var(--space-md) var(--space-compact);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-body);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  box-sizing: border-box;
}

.field-select {
  max-width: 280px;
}

.profile-content {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h4 {
  margin: 1em 0 0.3em;
  font-size: 0.95em;
  color: var(--color-text);
}

.badge-admin {
  display: inline-block;
  font-size: var(--font-sm);
  padding: 0.1em var(--space-sm);
  border-radius: var(--radius-sm);
  background: #fce4ec;
  color: var(--color-danger);
  margin-left: var(--space-sm);
  vertical-align: middle;
}

.badge-user {
  display: inline-block;
  font-size: var(--font-sm);
  padding: 0.1em var(--space-sm);
  border-radius: var(--radius-sm);
  background: #e8f5e9;
  color: var(--color-success);
  margin-left: var(--space-sm);
  vertical-align: middle;
}

button {
  margin-right: 0.5em;
}
</style>
