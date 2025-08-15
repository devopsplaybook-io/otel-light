<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/"><strong>OTEL Light</strong></NuxtLink>
      </li>
    </ul>
    <ul class="menu-links">
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/traces"
          :class="activeRoute == '/traces' ? 'active' : 'inactive'"
          ><i class="bi bi-robot"></i
        ></NuxtLink>
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/traces/stats"
          :class="activeRoute == '/traces/stats' ? 'active' : 'inactive'"
          ><i class="bi bi-speedometer"></i
        ></NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/users"
          :class="activeRoute == '/users' ? 'active' : 'inactive'"
          ><i class="bi bi-person-circle"></i
        ></NuxtLink>
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
import Config from "~~/services/Config.ts";

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    if (await AuthenticationStore().ensureAuthenticated()) {
      setTimeout(async () => {
        // Renew session tocken
        axios
          .post(
            `${(await Config.get()).SERVER_URL}/users/session`,
            {},
            await AuthService.getAuthHeader()
          )
          .then((res) => {
            AuthService.saveToken(res.data.token);
          });
      }, 10000);
    }
    PreferencesService.applyTheme();
  },
  methods: {
    routeUpdated(newRoute) {
      this.activeRoute = newRoute.fullPath.split("?")[0];
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
  font-size: 1.1em;
}
.menu-links .inactive {
  opacity: 0.3;
}
.menu-links .active {
  color: #3cabff;
}
</style>
