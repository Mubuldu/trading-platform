import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/tests/unit/**/*.spec.ts', '<rootDir>/tests/integration/**/*.spec.ts'],
  // Infra tests (tests/integration/infra/) require real Docker services.
  // Run them separately with: pnpm test:infra
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/integration/infra/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // kysely is ESM-only. This regex handles both direct installs and pnpm's
  // .pnpm/kysely@version/node_modules/kysely nested layout.
  transformIgnorePatterns: ['node_modules/(?!kysely/|.*node_modules/kysely/)'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.dto.ts'],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testEnvironment: 'node',
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
