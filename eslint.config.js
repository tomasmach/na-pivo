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
    // The shared Modal keeps sheets in their half on the open iPhone Duo and
    // keeps a half with an open sheet mounted while the phone folds.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/components/shared/Modal.tsx", "src/__mocks__/**", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native",
          importNames: ["Modal"],
          message: "Use Modal from '@/components/shared/Modal'.",
        }],
      }],
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
