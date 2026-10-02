// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt({
  name: "otel-light-web/relaxed-rules",
  rules: {
    // The codebase uses `any` for API payloads and static-class services;
    // these patterns predate lint and are kept as-is.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-extraneous-class": "off",
    "@typescript-eslint/no-dynamic-delete": "off",
    "no-useless-assignment": "off",
    // Keep dead code visible without failing CI.
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { args: "none", caughtErrors: "none" },
    ],
    // Formatting rules (self-closing tags, attribute order/hyphenation,
    // component option order, `this` usage) do not match the existing
    // prettier-like style; do not mass-reformat the codebase for lint.
    "vue/html-self-closing": "off",
    "vue/attributes-order": "off",
    "vue/attribute-hyphenation": "off",
    "vue/order-in-components": "off",
    "vue/this-in-template": "off",
    "vue/v-on-event-hyphenation": "off",
    "vue/v-bind-style": "off",
    // SFCs combining <script setup> and <script> make `import/first` misfire,
    // and existing component names / template roots are deliberate.
    "import/first": "off",
    "import/no-duplicates": "off",
    "vue/multi-word-component-names": "off",
    "vue/no-unused-components": "off",
    "vue/no-multiple-template-root": "off",
    "vue/valid-template-root": "off",
    "vue/no-reserved-keys": "off",
  },
});
