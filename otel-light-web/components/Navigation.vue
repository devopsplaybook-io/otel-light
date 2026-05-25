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
      <li
        v-if="
          authenticationStore.isAuthenticated && authenticationStore.isAdmin
        "
      >
        <NuxtLink
          to="/settings"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/users"
          :class="activeRoute == '/users' ? 'active' : 'inactive'"
          ><i class="bi bi-person-circle"></i>
          <span class="nav-label">Profile</span></NuxtLink
        >
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
import { PreferencesService } from "~/services/PreferencesService";
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import { SERVER_URL } from "~~/services/Config.ts";

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
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    if (await AuthenticationStore().ensureAuthenticated()) {
      this._renewTimer = setTimeout(async () => {
        // Renew session token
        try {
          const res = await axios.post(
            `${SERVER_URL}/users/session`,
            {},
            await AuthService.getAuthHeader(),
          );
          AuthService.saveToken(res.data.token);
          AuthenticationStore().refreshFromToken();
        } catch {
          // silently ignore
        }
      }, 10000);
    }
    PreferencesService.applyTheme();
  },
  beforeUnmount() {
    if (this._renewTimer) {
      clearTimeout(this._renewTimer);
      this._renewTimer = null;
    }
  },
  methods: {
    routeUpdated(newRoute) {
      const segments = newRoute.fullPath.split("?")[0].split("/");
      this.activeRoute = segments.length > 1 ? `/${segments[1]}` : "/";
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
