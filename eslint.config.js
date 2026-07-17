// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  // Global ignore: the Django backend (its .venv alone is ~7k files).
  { ignores: ["backend/**"] },
  expoConfig,
  {
    ignores: ["dist/*"],
    settings: {
      // Prefer TypeScript's resolver for typed ESM packages whose conditional
      // exports are valid for Metro/tsc but not understood by the Node resolver.
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
  },
  {
    // Node CLI scripts run under CommonJS, where __dirname/require exist.
    files: ["scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
      },
    },
  }
]);
