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
    </article>

    <!-- AUTHENTICATED: Profile Section -->
    <div v-else class="profile-content">
      <!-- Account Info -->
      <article>
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
      <article>
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

      <!-- Preferences -->
      <article>
        <h3>
          <i class="bi bi-sliders"></i>
          Preferences
        </h3>
        <h4>Refresh</h4>
        <label for="refresh-interval">
          Auto-refresh interval (Traces and Logs):
        </label>
        <select
          id="refresh-interval"
          v-model="refreshInterval"
          @change="saveRefreshInterval"
        >
          <option value="0">No auto-refresh</option>
          <option value="5000">5 seconds</option>
          <option value="10000">10 seconds</option>
          <option value="30000">30 seconds</option>
          <option value="60000">1 minute</option>
        </select>

        <h4>Dark Mode</h4>
        <button class="secondary" @click="toggleTheme">
          <i class="bi" :class="isDark ? 'bi-sun-fill' : 'bi-moon-fill'"></i>
          Switch to {{ isDark ? "Light" : "Dark" }} Mode
        </button>

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
      </article>
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

.profile-card {
  max-width: 480px;
  width: 100%;
}

.profile-content {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  margin: 1.5em 0 0.3em;
  font-size: 0.95em;
}

article h4:first-child {
  margin-top: 1em;
}

.article-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}
</style>
