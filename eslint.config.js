import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        localStorage: "readonly",
        Math: "readonly",
        JSON: "readonly",
        devicePixelRatio: "readonly",
        innerWidth: "readonly",
        innerHeight: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
        addEventListener: "readonly",
        queueMicrotask: "readonly",
        navigator: "readonly",
        getComputedStyle: "readonly",
        process: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        self: "readonly",
        caches: "readonly",
        fetch: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-empty": "warn"
    }
  }
];
