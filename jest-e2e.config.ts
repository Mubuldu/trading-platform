import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/tests/e2e/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // kysely is ESM-only — same pattern as jest.config.ts and jest-integration-live.config.ts
  transformIgnorePatterns: ['node_modules/(?!kysely/|.*node_modules/kysely/)'],
  testEnvironment: 'node',
  // Real network I/O: testnet RTT + initialization can take several seconds
  testTimeout: 30_000,
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@trading-platform/strategy-sdk$': '<rootDir>/sdk/strategy-sdk/src/index.ts',
    '^@trading-platform/strategy-sdk/(.*)$': '<rootDir>/sdk/strategy-sdk/src/$1',
  },
  verbose: true,
};

export default config;
