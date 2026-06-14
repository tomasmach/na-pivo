/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          strict: true,
          resolveJsonModule: true,
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
          types: ['jest', 'node'],
        },
      },
    ],
    // Transform ESM-only packages (kdbush, geokdbush)
    '^.+\\.m?js$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          allowJs: true,
          esModuleInterop: true,
        },
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^expo-linking$': '<rootDir>/src/__mocks__/expo-linking.ts',
    '^expo-constants$': '<rootDir>/src/__mocks__/expo-constants.ts',
    '^expo-secure-store$': '<rootDir>/src/__mocks__/expo-secure-store.ts',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
    '^react-native-svg$': '<rootDir>/src/__mocks__/react-native-svg.ts',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  passWithNoTests: true,
  // kdbush, geokdbush, tinyqueue and react-native packages need transformation
  transformIgnorePatterns: [
    'node_modules/(?!(kdbush|geokdbush|tinyqueue|react-native|@react-native|expo|@expo|@unimodules|unimodules|sentry-expo|native-base|react-clone-referenced-element)/)',
  ],
};
