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
    '^(?:\\.\\./)+modules/beer-live-activity$':
      '<rootDir>/src/__mocks__/beer-live-activity.ts',
    '^expo-linking$': '<rootDir>/src/__mocks__/expo-linking.ts',
    '^expo-constants$': '<rootDir>/src/__mocks__/expo-constants.ts',
    '^expo-secure-store$': '<rootDir>/src/__mocks__/expo-secure-store.ts',
    '^expo-file-system$': '<rootDir>/src/__mocks__/expo-file-system.ts',
    '^expo-clipboard$': '<rootDir>/src/__mocks__/expo-clipboard.ts',
    '^expo-glass-effect$': '<rootDir>/src/__mocks__/expo-glass-effect.ts',
    '^expo-sharing$': '<rootDir>/src/__mocks__/expo-sharing.ts',
    '^react-native-view-shot$': '<rootDir>/src/__mocks__/react-native-view-shot.ts',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
    '^react-native-svg$': '<rootDir>/src/__mocks__/react-native-svg.ts',
    '\\.(png|jpg|jpeg|gif|ttf|mp3|wav)$': '<rootDir>/src/__mocks__/assetFileMock.ts',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/backend/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/backend/', '<rootDir>/.claude/'],
  watchPathIgnorePatterns: ['<rootDir>/backend/'],
  passWithNoTests: true,
  // kdbush, geokdbush, tinyqueue and react-native packages need transformation
  transformIgnorePatterns: [
    'node_modules/(?!(kdbush|geokdbush|tinyqueue|react-native|@react-native|expo|@expo|@unimodules|unimodules|sentry-expo|native-base|react-clone-referenced-element)/)',
  ],
};
