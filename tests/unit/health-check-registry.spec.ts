import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import {
  NamedHealthCheck,
  ProviderHealth,
  healthyResult,
  unhealthyResult,
  degradedResult,
} from '@infrastructure/health/health-check.interface';
import { AppLoggerService } from '@core/logging/app-logger.service';

function makeLogger(): AppLoggerService {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    info: jest.fn(),
    critical: jest.fn(),
    fatal: jest.fn(),
  } as unknown as AppLoggerService;
}

function makeCheck(name: string, health: ProviderHealth): NamedHealthCheck {
  return { name, check: async () => health };
}

describe('HealthCheckRegistry', () => {
  let registry: HealthCheckRegistry;

  beforeEach(() => {
    registry = new HealthCheckRegistry(makeLogger());
  });

  describe('register()', () => {
    it('registers a check', () => {
      registry.register(makeCheck('db', healthyResult()));
      expect(registry.registeredNames).toContain('db');
    });

    it('overwrites duplicate check names', () => {
      registry.register(makeCheck('db', healthyResult()));
      registry.register(makeCheck('db', unhealthyResult('down')));
      const names = registry.registeredNames.filter((n) => n === 'db');
      expect(names).toHaveLength(1);
    });
  });

  describe('runAll()', () => {
    it('returns healthy when all checks are healthy', async () => {
      registry.register(makeCheck('a', healthyResult()));
      registry.register(makeCheck('b', healthyResult()));
      const result = await registry.runAll();
      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(2);
    });

    it('returns degraded when any check is degraded', async () => {
      registry.register(makeCheck('a', healthyResult()));
      registry.register(makeCheck('b', degradedResult('slow')));
      const result = await registry.runAll();
      expect(result.status).toBe('degraded');
    });

    it('returns unhealthy when any check is unhealthy', async () => {
      registry.register(makeCheck('a', healthyResult()));
      registry.register(makeCheck('b', unhealthyResult('down')));
      const result = await registry.runAll();
      expect(result.status).toBe('unhealthy');
    });

    it('returns healthy for empty registry', async () => {
      const result = await registry.runAll();
      expect(result.status).toBe('healthy');
    });

    it('catches thrown errors in checks and marks as unhealthy', async () => {
      registry.register({
        name: 'throwing',
        check: async () => {
          throw new Error('check exploded');
        },
      });
      const result = await registry.runAll();
      expect(result.status).toBe('unhealthy');
    });
  });

  describe('runSingle()', () => {
    it('runs a specific check by name', async () => {
      registry.register(makeCheck('cache', healthyResult('ok')));
      const result = await registry.runSingle('cache');
      expect(result?.name).toBe('cache');
      expect(result?.health.status).toBe('healthy');
    });

    it('returns undefined for unregistered name', async () => {
      const result = await registry.runSingle('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('unregister()', () => {
    it('removes a check', () => {
      registry.register(makeCheck('x', healthyResult()));
      registry.unregister('x');
      expect(registry.registeredNames).not.toContain('x');
    });
  });
});
