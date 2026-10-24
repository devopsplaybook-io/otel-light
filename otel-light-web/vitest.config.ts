import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL("./", import.meta.url)).replace(
  /\/$/,
  "",
);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "~~": projectRoot,
      "~": projectRoot,
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.spec.ts"],
  },
});
