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
    rules: {
      // `react-native-ios-context-menu` 3.2.1 ships no built `lib/`, so its
      // `main` points at a file that does not exist. Metro resolves it through
      // the package's `react-native: src/index` field and tsc through
      // `types/react-native-ios-context-menu.d.ts`; only this resolver is left
      // out. Drop the exception when the package ships its build output.
      "import/no-unresolved": [
        "error",
        { ignore: ["^react-native-ios-context-menu$"] },
      ],
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
