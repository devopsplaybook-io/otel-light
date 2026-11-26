// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  // common-web is consumed as raw .vue/.ts sources (not as a Nuxt layer, so its
  // global CSS does not leak here). Map the package to its installed directory
  // so both Vite and the generated tsconfig resolve the raw subpath imports.
  alias: {
    "@devopsplaybook.io/common-web": fileURLToPath(
      new URL("./node_modules/@devopsplaybook.io/common-web", import.meta.url),
    ),
  },
  build: {
    transpile: ["@devopsplaybook.io/common-web"],
  },
  vite: {
    optimizeDeps: {
      exclude: ["@devopsplaybook.io/common-web"],
    },
  },
  app: {
    head: {
      charset: "utf-8",
      viewport:
        "width=device-width, initial-scale=1, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "OTel Light",
      meta: [
        { name: "description", content: "otel-light" },
        { name: "theme-color", content: "#212121" },
      ],
      link: [
        { rel: "icon", href: "/images/logo.png" },
        { rel: "stylesheet", href: "/styles.css" },
      ],
    },
  },
  css: [
    "~/assets/css/main.css",
    "~/assets/css/tab-navigation.css",
    "~/assets/css/apexcharts.css",
  ],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt", "@nuxt/eslint"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
  pwa: {
    // Prompt mode keeps the old worker controlling until the user accepts the
    // shared update banner (components/AppUpdatePrompt.vue): a new build must
    // never silently reload the tab.
    registerType: "prompt",
    // Keep the sw.js fetch off the HTTP cache so a new build is noticed.
    updateViaCache: "none",
    // PWA options
    manifest: {
      name: "APPLICATION_TITLE",
      short_name: "APPLICATION_TITLE",
      lang: "en-US",
      start_url: "/",
      display: "standalone",
      background_color: "#12191f",
      theme_color: "#12191f",
      icons: [
        {
          src: "images/logo.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
  },
});
