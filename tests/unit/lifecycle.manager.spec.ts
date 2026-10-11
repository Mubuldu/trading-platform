import { LifecycleManager } from '@infrastructure/lifecycle/lifecycle.manager';
import { ServiceRegistry } from '@infrastructure/lifecycle/service-registry';
import { LifecycleHook } from '@infrastructure/lifecycle/lifecycle-hook.interface';
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

function makeRegistry(): ServiceRegistry {
  return {
    updateStatus: jest.fn(),
    register: jest.fn(),
    deregister: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn().mockReturnValue([]),
    isHealthy: jest.fn().mockReturnValue(true),
    areAllHealthy: jest.fn().mockReturnValue(true),
  } as unknown as ServiceRegistry;
}

describe('LifecycleManager', () => {
  let manager: LifecycleManager;
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = makeRegistry();
    manager = new LifecycleManager(makeLogger(), registry);
  });

  describe('register()', () => {
    it('accepts lifecycle hooks', () => {
      const hook: LifecycleHook = { serviceName: 'db', priority: 100 };
      manager.register(hook);
      expect(manager.registeredHooks).toContain('db');
    });
  });

  describe('onApplicationBootstrap()', () => {
    it('calls onStart on all hooks', async () => {
      const aStart = jest.fn().mockResolvedValue(undefined);
      const bStart = jest.fn().mockResolvedValue(undefined);
      manager.register({ serviceName: 'a', priority: 50, onStart: aStart });
      manager.register({ serviceName: 'b', priority: 10, onStart: bStart });

      await manager.onApplicationBootstrap();

      expect(aStart).toHaveBeenCalled();
      expect(bStart).toHaveBeenCalled();
    });

    it('runs higher priority hooks first', async () => {
      const order: string[] = [];
      manager.register({
        serviceName: 'low',
        priority: 10,
        onStart: async () => {
          order.push('low');
        },
      });
      manager.register({
        serviceName: 'high',
        priority: 100,
        onStart: async () => {
          order.push('high');
        },
      });

      await manager.onApplicationBootstrap();

      expect(order).toEqual(['high', 'low']);
    });

    it('continues running remaining hooks when one fails', async () => {
      const bStart = jest.fn().mockResolvedValue(undefined);
      manager.register({
        serviceName: 'a',
        priority: 100,
        onStart: async () => {
          throw new Error('start failed');
        },
      });
      manager.register({ serviceName: 'b', priority: 50, onStart: bStart });

      await manager.onApplicationBootstrap();

      expect(bStart).toHaveBeenCalled();
    });

    it('marks isStarted true after bootstrap', async () => {
      await manager.onApplicationBootstrap();
      expect(manager.isStarted).toBe(true);
    });
  });

  describe('beforeApplicationShutdown()', () => {
    it('calls onStop on all hooks in reverse priority', async () => {
      const order: string[] = [];
      manager.register({
        serviceName: 'high',
        priority: 100,
        onStop: async () => {
          order.push('high');
        },
      });
      manager.register({
        serviceName: 'low',
        priority: 10,
        onStop: async () => {
          order.push('low');
        },
      });

      await manager.beforeApplicationShutdown('SIGTERM');

      expect(order).toEqual(['low', 'high']);
    });

    it('continues shutdown even when one hook fails', async () => {
      const spy = jest.fn().mockResolvedValue(undefined);
      manager.register({
        serviceName: 'fail',
        priority: 100,
        onStop: async () => {
          throw new Error('stop failed');
        },
      });
      manager.register({ serviceName: 'ok', priority: 50, onStop: spy });

      await manager.beforeApplicationShutdown();

      expect(spy).toHaveBeenCalled();
    });
  });
});
