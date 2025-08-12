<template>
  <div class="user-page">
    <div v-if="!authenticationStore.isAuthenticated">
      <h1 v-if="isInitialized">Login</h1>
      <h1 v-else>New User</h1>
      <label>Name</label>
      <input id="username" v-model="user.name" type="text" />
      <label>Password</label>
      <input id="passwrd" v-model="user.password" type="password" />
      <button
        v-if="!authenticationStore.isAuthenticated && !isInitialized"
        v-on:click="saveNew()"
      >
        Create
      </button>
      <button
        v-if="!authenticationStore.isAuthenticated && isInitialized"
        v-on:click="login()"
      >
        Login
      </button>
    </div>
    <div v-else>
      <h1>Authenticated</h1>
      <button v-on:click="logout()">Logout</button>
      <button
        v-if="!isChangePasswordStarted"
        v-on:click="changePasswordStart(true)"
      >
        Change Password
      </button>
      <article v-else>
        <h1>Change Password</h1>
        <label>Old Password</label>
        <input id="password" v-model="user.passwordOld" type="password" />
        <label>New Password</label>
        <input id="passwordOld" v-model="user.password" type="password" />
        <button v-on:click="changePassword()">Change</button>
        <button v-on:click="changePasswordStart(false)">Cancel</button>
      </article>
      <h1>Settings</h1>
      <div>
        <label for="refresh-interval">Auto-refresh interval:</label>
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
      </div>

      <h1>Dark Mode</h1>
      <button @click="toggleTheme" style="margin-bottom: 1em">
        Switch to {{ isDark ? "Light" : "Dark" }} Mode
      </button>
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
import { PreferencesService } from "~/services/PreferencesService";

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
      isDark,
      refreshInterval: RefreshIntervalService.get(),
    };
  },
  async created() {
    this.isInitialized = await UserService.isInitialized();
    AuthenticationStore().isAuthenticated = await AuthService.isAuthenticated();
    this.refreshInterval = RefreshIntervalService.get();
  },
  methods: {
    async saveNew() {
      if (this.user.name && this.user.password) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/users`,
            this.user,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "User created",
            });
            this.isInitialized = true;
            this.login();
          })
          .catch(handleError);
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Username or password missing",
        });
      }
    },
    async login() {
      if (this.user.name && this.user.password) {
        await axios
          .post(
            `${(await Config.get()).SERVER_URL}/users/session`,
            this.user,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            AuthService.saveToken(res.data.token);
            AuthenticationStore().isAuthenticated = true;
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "User Logged In",
            });
            useRouter().push({ path: "/" });
          })
          .catch(handleError);
      } else {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Username or password missing",
        });
      }
    },
    async changePassword() {
      if (this.user.password && this.user.passwordOld) {
        await axios
          .put(
            `${(await Config.get()).SERVER_URL}/users/password`,
            this.user,
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "info",
              text: "Password Changed",
            });
            this.isChangePasswordStarted = false;
            this.user = {};
          })
          .catch(handleError);
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
          this.refreshInterval
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
  },
};
</script>

<style scoped>
.user-page {
  width: min(100%, 50em);
}
button {
  margin-right: 1em;
}
h1 {
  margin-top: 1em;
}
</style>
