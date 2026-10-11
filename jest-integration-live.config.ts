/**
 * Jest config for infrastructure integration tests.
 *
 * These tests require real Docker services:
 *   • Redis  on localhost:6380
 *   • PostgreSQL on localhost:5433
 *
 * Start them first:
 *   docker compose -f docker-compose.test.yml up -d --wait
 *
 * Run with:
 *   pnpm test:infra
 *
 * When the services are not running, each test suite returns early
 * (passes trivially) so CI pipelines that don't mount Docker-in-Docker
 * remain green. Skipped suites are logged with a hint to start containers.
 *
 * Override connection coordinates via env vars:
 *   TEST_REDIS_HOST, TEST_REDIS_PORT (default 6380)
 *   TEST_PG_HOST, TEST_PG_PORT (default 5433), TEST_PG_DB, TEST_PG_USER, TEST_PG_PASS
 */
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/tests/integration/infra/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // kysely is ESM-only — same pattern as jest.config.ts
  transformIgnorePatterns: ['node_modules/(?!kysely/|.*node_modules/kysely/)'],
  testEnvironment: 'node',
  // Real network I/O: each test has up to 15 s; suite setup/teardown up to 30 s
  testTimeout: 15_000,
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
