import { ServiceRegistry } from '@infrastructure/lifecycle/service-registry';

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  const baseRegistration = {
    name: 'trading-platform',
    version: '1.0.0',
    capabilities: ['trading'],
    startedAt: new Date(),
    status: 'starting' as const,
  };

  describe('register()', () => {
    it('registers a service', () => {
      registry.register(baseRegistration);
      expect(registry.get('trading-platform')).toBeDefined();
    });

    it('sets lastStatusChange on registration', () => {
      registry.register(baseRegistration);
      const svc = registry.get('trading-platform')!;
      expect(svc.lastStatusChange).toBeInstanceOf(Date);
    });
  });

  describe('updateStatus()', () => {
    it('updates status', () => {
      registry.register(baseRegistration);
      registry.updateStatus('trading-platform', 'healthy');
      expect(registry.get('trading-platform')?.status).toBe('healthy');
    });

    it('ignores unknown service names', () => {
      expect(() => registry.updateStatus('unknown', 'healthy')).not.toThrow();
    });
  });

  describe('deregister()', () => {
    it('removes the service', () => {
      registry.register(baseRegistration);
      registry.deregister('trading-platform');
      expect(registry.get('trading-platform')).toBeUndefined();
    });
  });

  describe('isHealthy()', () => {
    it('returns true for healthy service', () => {
      registry.register({ ...baseRegistration, status: 'healthy' });
      expect(registry.isHealthy('trading-platform')).toBe(true);
    });

    it('returns false for non-healthy service', () => {
      registry.register(baseRegistration);
      expect(registry.isHealthy('trading-platform')).toBe(false);
    });
  });

  describe('areAllHealthy()', () => {
    it('returns true when all services are healthy', () => {
      registry.register({ ...baseRegistration, name: 'svc-a', status: 'healthy' });
      registry.register({ ...baseRegistration, name: 'svc-b', status: 'healthy' });
      expect(registry.areAllHealthy()).toBe(true);
    });

    it('returns false when any service is not healthy', () => {
      registry.register({ ...baseRegistration, name: 'svc-a', status: 'healthy' });
      registry.register({ ...baseRegistration, name: 'svc-b', status: 'degraded' });
      expect(registry.areAllHealthy()).toBe(false);
    });

    it('returns true for empty registry', () => {
      expect(registry.areAllHealthy()).toBe(true);
    });
  });

  describe('getAll()', () => {
    it('returns all registered services', () => {
      registry.register({ ...baseRegistration, name: 'svc-1' });
      registry.register({ ...baseRegistration, name: 'svc-2' });
      expect(registry.getAll()).toHaveLength(2);
    });
  });
});
