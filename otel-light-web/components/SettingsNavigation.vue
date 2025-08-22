<template>
  <div class="settings-navigation">
    <nav>
      <ul class="menu-links">
        <li>
          <NuxtLink
            to="/settings/maintenance"
            :class="isActive('/settings/maintenance') ? 'active' : 'inactive'"
          >
            Maintenance
          </NuxtLink>
        </li>
        <li>
          <NuxtLink
            to="/settings/tokens"
            :class="isActive('/settings/tokens') ? 'active' : 'inactive'"
          >
            Tokens
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>

<script setup>
import { useRoute } from "vue-router";

const route = useRoute();

function isActive(path) {
  // Only match the first two segments for settings subpages
  return route.path.startsWith(path);
}
</script>

<style scoped>
.settings-navigation {
  margin-bottom: 1rem;
}
.menu-links {
  width: 100%;
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0;
  font-weight: bold;
}
.menu-links li {
  padding-top: 0.2em;
  padding-bottom: 0.2em;
  padding-right: 1em;
  font-size: 1.1em;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: border-color 0.2s, color 0.2s;
}
.menu-links .inactive {
  opacity: 0.3;
}
.menu-links .active {
  color: #3cabff;
  border-bottom: 2px solid #3cabff;
  font-weight: bold;
}
:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: #033452;
  border-bottom: 2px solid #033452;
}
</style>
