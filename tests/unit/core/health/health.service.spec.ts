import { ConfigService } from '@nestjs/config';
import { HealthService } from '@core/health/health.service';
import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import { InMemoryMetricsService } from '@core/metrics/in-memory-metrics.service';
import { AppConfig } from '@config/app.config';

const mockAppConfig: AppConfig = {
  name: 'trading-platform',
  port: 3000,
  version: '1.0.0',
  environment: 'test',
  swagger: { enabled: false },
  cors: { origins: [] },
  security: { apiKeySecret: 'secret' },
};

function makeConfigService(cfg: AppConfig = mockAppConfig): ConfigService {
  return { get: jest.fn().mockReturnValue(cfg) } as unknown as ConfigService;
}

function makeRegistry(
  status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy',
): HealthCheckRegistry {
  return {
    runAll: jest.fn().mockResolvedValue({
      status,
      checks: [{ name: 'database', health: { status, latencyMs: 2 } }],
      checkedAt: new Date(),
    }),
  } as unknown as HealthCheckRegistry;
}

describe('HealthService', () => {
  // ── Liveness ───────────────────────────────────────────────────────────────

  describe('getLiveness()', () => {
    it('should return status "alive"', () => {
      const service = new HealthService(makeConfigService());
      expect(service.getLiveness().status).toBe('alive');
    });

    it('should return the current process PID', () => {
      const service = new HealthService(makeConfigService());
      expect(service.getLiveness().pid).toBe(process.pid);
    });

    it('should return a positive uptime', () => {
      const service = new HealthService(makeConfigService());
      expect(service.getLiveness().uptimeSeconds).toBeGreaterThan(0);
    });

    it('should return a valid ISO timestamp', () => {
      const service = new HealthService(makeConfigService());
      const { timestamp } = service.getLiveness();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  // ── Readiness ─────────────────────────────────────────────────────────────

  describe('getReadiness()', () => {
    it('should return ready:true and status "ready" when no registry is injected', async () => {
      const service = new HealthService(makeConfigService());
      const { response, isReady } = await service.getReadiness();
      expect(isReady).toBe(true);
      expect(response.status).toBe('ready');
    });

    it('should return ready:true when all checks are healthy', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('healthy'));
      const { isReady } = await service.getReadiness();
      expect(isReady).toBe(true);
    });

    it('should return ready:true when checks are degraded', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('degraded'));
      const { isReady } = await service.getReadiness();
      expect(isReady).toBe(true);
    });

    it('should return ready:false when any check is unhealthy', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('unhealthy'));
      const { response, isReady } = await service.getReadiness();
      expect(isReady).toBe(false);
      expect(response.status).toBe('not-ready');
    });

    it('should return not-ready when registry.runAll() throws', async () => {
      const throwingRegistry = {
        runAll: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      } as unknown as HealthCheckRegistry;
      const service = new HealthService(makeConfigService(), throwingRegistry);
      const { response, isReady } = await service.getReadiness();
      expect(isReady).toBe(false);
      expect(response.status).toBe('not-ready');
      expect(response.checks['registry']).toBeDefined();
    });

    it('should include check names in the response', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('healthy'));
      const { response } = await service.getReadiness();
      expect(response.checks['database']).toBeDefined();
    });
  });

  // ── Full health ────────────────────────────────────────────────────────────

  describe('getHealth()', () => {
    it('should return status "ok" when all checks pass', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('healthy'));
      const result = await service.getHealth();
      expect(result.status).toBe('ok');
    });

    it('should return status "error" when any check is unhealthy', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('unhealthy'));
      const result = await service.getHealth();
      expect(result.status).toBe('error');
    });

    it('should include application version and environment', async () => {
      const service = new HealthService(makeConfigService());
      const result = await service.getHealth();
      expect(result.info.application.version).toBe('1.0.0');
      expect(result.info.application.environment).toBe('test');
    });

    it('should include positive uptime', async () => {
      const service = new HealthService(makeConfigService());
      const result = await service.getHealth();
      expect(result.info.uptime.seconds).toBeGreaterThan(0);
    });

    it('should include positive memory values', async () => {
      const service = new HealthService(makeConfigService());
      const result = await service.getHealth();
      expect(result.info.memory.metrics.rss).toBeGreaterThan(0);
      expect(result.info.memory.metrics.heapUsed).toBeGreaterThan(0);
    });

    it('should include infrastructure checks when registry is provided', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('healthy'));
      const result = await service.getHealth();
      expect(result.infrastructure).toBeDefined();
      expect((result.infrastructure as Record<string, unknown>)['database']).toBeDefined();
    });

    it('should include a metrics summary when metricsStore is provided', async () => {
      const metricsStore = new InMemoryMetricsService();
      metricsStore.gauge('process.uptime_seconds', 3600);
      const service = new HealthService(makeConfigService(), undefined, metricsStore);
      const result = await service.getHealth();
      expect(result.metrics).toBeDefined();
      expect(result.metrics?.uptimeSeconds).toBeGreaterThan(0);
    });

    it('should omit metrics when no metricsStore is provided', async () => {
      const service = new HealthService(makeConfigService());
      const result = await service.getHealth();
      expect(result.metrics).toBeUndefined();
    });
  });

  // ── Stress: concurrent health checks ─────────────────────────────────────

  describe('concurrent readiness checks', () => {
    it('should handle 50 simultaneous calls without error', async () => {
      const service = new HealthService(makeConfigService(), makeRegistry('healthy'));
      const results = await Promise.all(Array.from({ length: 50 }, () => service.getReadiness()));
      expect(results).toHaveLength(50);
      results.forEach(({ isReady }) => expect(isReady).toBe(true));
    });
  });
});
