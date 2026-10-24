<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" class="brand-link"
          ><img src="/images/logo.svg" alt="OTEL Light" class="nav-logo" />
          <strong>OTEL Light</strong></NuxtLink
        >
      </li>
    </ul>
    <ul class="menu-links">
      <li>
        <NuxtLink
          to="/"
          :class="activeRoute == '/' ? 'active' : 'inactive'"
          ><i class="bi bi-speedometer2"></i>
          <span class="nav-label">Dashboard</span></NuxtLink
        >
      </li>
      <li
        v-if="
          authenticationStore.isAuthenticated &&
          authenticationStore.hasTracesScope
        "
      >
        <NuxtLink
          to="/traces"
          :class="activeRoute == '/traces' ? 'active' : 'inactive'"
          ><i class="bi bi-list-nested"></i>
          <span class="nav-label">Traces</span></NuxtLink
        >
      </li>
      <li
        v-if="
          authenticationStore.isAuthenticated &&
          authenticationStore.hasMetricsScope
        "
      >
        <NuxtLink
          to="/metrics"
          :class="activeRoute == '/metrics' ? 'active' : 'inactive'"
          ><i class="bi bi-bar-chart-line"></i>
          <span class="nav-label">Metrics</span></NuxtLink
        >
      </li>
      <li
        v-if="
          authenticationStore.isAuthenticated &&
          authenticationStore.hasLogsScope
        "
      >
        <NuxtLink
          to="/logs"
          :class="activeRoute == '/logs' ? 'active' : 'inactive'"
          ><i class="bi bi-card-text"></i>
          <span class="nav-label">Logs</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/settings"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
      <li>
        <a
          href="#"
          class="theme-toggle inactive"
          @click.prevent="toggleTheme"
          :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          ><i class="bi" :class="isDark ? 'bi-sun-fill' : 'bi-moon-fill'"></i>
          <span class="nav-label">{{ isDark ? "Light" : "Dark" }}</span></a
        >
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { PreferencesService } from "~/services/PreferencesService";
const authenticationStore = AuthenticationStore();
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import {
  SessionRenewalDelayMs,
  SessionRenewalIsAuthError,
  SessionRenewalRefresh,
} from "~~/services/SessionRenewal";

const RENEWAL_RETRY_DELAY_MS = 60_000;

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
      _renewTimer: null,
      isDark: false,
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    this.isDark = PreferencesService.isDark();
    if (await AuthenticationStore().ensureAuthenticated()) {
      this.scheduleRenewal();
    }
    this._stopAuthWatch = this.$watch(
      () => AuthenticationStore().isAuthenticated,
      (isAuthenticated) => {
        if (isAuthenticated) {
          this.scheduleRenewal();
        } else {
          this.clearRenewal();
        }
      },
    );
    PreferencesService.applyTheme();
  },
  beforeUnmount() {
    this.clearRenewal();
    if (this._stopAuthWatch) {
      this._stopAuthWatch();
      this._stopAuthWatch = null;
    }
  },
  methods: {
    routeUpdated(newRoute) {
      const segments = newRoute.fullPath.split("?")[0].split("/");
      this.activeRoute = segments.length > 1 ? `/${segments[1]}` : "/";
    },
    toggleTheme() {
      PreferencesService.toggleTheme(this);
    },
    clearRenewal() {
      if (this._renewTimer) {
        clearTimeout(this._renewTimer);
        this._renewTimer = null;
      }
    },
    scheduleRenewal(delayMs) {
      this.clearRenewal();
      const tokenInfo = AuthService.getTokenInfo();
      if (!tokenInfo) {
        return;
      }
      const delay =
        delayMs ?? SessionRenewalDelayMs(tokenInfo.exp, Date.now());
      this._renewTimer = setTimeout(() => this.renewSession(), delay);
    },
    async renewSession() {
      this._renewTimer = null;
      try {
        await SessionRenewalRefresh();
        await AuthenticationStore().refreshFromToken();
        this.scheduleRenewal();
      } catch (error) {
        if (SessionRenewalIsAuthError(error)) {
          AuthService.removeToken();
          await AuthenticationStore().ensureAuthenticated();
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "error",
            text: "Your session has expired. Please sign in again.",
          });
          this.$router.push("/settings/profile");
          return;
        }
        // Transient failure: retry while the current token is still valid.
        const tokenInfo = AuthService.getTokenInfo();
        if (tokenInfo && tokenInfo.exp * 1_000 > Date.now()) {
          this.scheduleRenewal(RENEWAL_RETRY_DELAY_MS);
        }
      }
    },
  },
};
</script>

<style scoped>
.menu-links li {
  padding-top: 0.2em;
  padding-bottom: 0.2em;
}
.menu-links li {
  padding-right: 1em;
  font-size: 1em;
}
.menu-links .inactive {
  opacity: 0.5;
}
.menu-links .active {
  color: #3cabff;
}
.menu-links {
  font-weight: bold;
}

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: 0.5rem;
}

.menu-links i {
  margin-right: 0.5rem;
}

.theme-toggle {
  cursor: pointer;
}

/* Hide nav labels on narrow screens */
@media (max-width: 1000px) {
  .nav-label {
    display: none;
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: #033452;
}
</style>
