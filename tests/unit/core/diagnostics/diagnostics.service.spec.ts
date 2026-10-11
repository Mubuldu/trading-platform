import { DiagnosticsService } from '@core/diagnostics/diagnostics.service';
import { InMemoryMetricsService } from '@core/metrics/in-memory-metrics.service';
import { TracingService } from '@core/tracing/tracing.service';
import { runWithContext } from '@core/logging/correlation-id.store';

describe('DiagnosticsService', () => {
  let service: DiagnosticsService;
  let metricsStore: InMemoryMetricsService;
  let tracingService: TracingService;

  beforeEach(() => {
    metricsStore = new InMemoryMetricsService();
    tracingService = new TracingService();
    service = new DiagnosticsService(metricsStore, tracingService);
  });

  // ── Runtime stats ─────────────────────────────────────────────────────────

  describe('getRuntimeStats()', () => {
    it('should return the current process PID', () => {
      expect(service.getRuntimeStats().pid).toBe(process.pid);
    });

    it('should return the Node.js version string', () => {
      const stats = service.getRuntimeStats();
      expect(stats.nodeVersion).toMatch(/^v\d+/);
    });

    it('should return a valid platform string', () => {
      const stats = service.getRuntimeStats();
      expect(['win32', 'linux', 'darwin', 'freebsd']).toContain(stats.platform);
    });

    it('should return a valid arch string', () => {
      const stats = service.getRuntimeStats();
      expect(['x64', 'arm64', 'ia32']).toContain(stats.arch);
    });

    it('should return a positive uptime', () => {
      expect(service.getRuntimeStats().uptimeSeconds).toBeGreaterThan(0);
    });

    it('should return positive memory values', () => {
      const { memory } = service.getRuntimeStats();
      expect(memory.rssBytes).toBeGreaterThan(0);
      expect(memory.heapUsedBytes).toBeGreaterThan(0);
      expect(memory.heapTotalBytes).toBeGreaterThan(0);
    });

    it('should return positive v8 heap values', () => {
      const { heap } = service.getRuntimeStats();
      expect(heap.usedBytes).toBeGreaterThan(0);
      expect(heap.totalBytes).toBeGreaterThan(0);
      expect(heap.limitBytes).toBeGreaterThan(0);
    });

    it('should return non-negative CPU values', () => {
      const { cpu } = service.getRuntimeStats();
      expect(cpu.userMs).toBeGreaterThanOrEqual(0);
      expect(cpu.systemMs).toBeGreaterThanOrEqual(0);
    });

    it('should return numeric handle counts (may be -1 if unavailable)', () => {
      const { handles } = service.getRuntimeStats();
      expect(typeof handles.activeHandles).toBe('number');
      expect(typeof handles.activeRequests).toBe('number');
    });
  });

  // ── Metrics snapshot ──────────────────────────────────────────────────────

  describe('getMetricsSnapshot()', () => {
    it('should return the current metrics from the store', () => {
      metricsStore.gauge('process.uptime_seconds', 3600);
      const snap = service.getMetricsSnapshot() as { gauges: Record<string, number> };
      expect(snap.gauges['process.uptime_seconds']).toBe(3600);
    });

    it('should return an empty object when no metricsStore is provided', () => {
      const noStoreService = new DiagnosticsService();
      expect(service.getMetricsSnapshot()).toBeDefined();
      expect(noStoreService.getMetricsSnapshot()).toEqual({});
    });
  });

  // ── Tracing spans ─────────────────────────────────────────────────────────

  describe('getActiveSpans()', () => {
    it('should return active spans from the tracing service', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        tracingService.startSpan('test.operation');
        expect(service.getActiveSpans()).toHaveLength(1);
      });
    });

    it('should return an empty array when no tracing service is provided', () => {
      const noTracingService = new DiagnosticsService(metricsStore);
      expect(noTracingService.getActiveSpans()).toEqual([]);
    });
  });

  describe('getRecentSpans()', () => {
    it('should return completed spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = tracingService.startSpan('completed.op');
        tracingService.endSpan(span.spanId, 'ok');
        expect(service.getRecentSpans(10)).toHaveLength(1);
      });
    });
  });

  // ── Heap snapshot ─────────────────────────────────────────────────────────

  describe('isProductionEnvironment()', () => {
    it('should reflect process.env.NODE_ENV', () => {
      const original = process.env['NODE_ENV'];
      try {
        process.env['NODE_ENV'] = 'production';
        expect(service.isProductionEnvironment()).toBe(true);
        process.env['NODE_ENV'] = 'development';
        expect(service.isProductionEnvironment()).toBe(false);
      } finally {
        process.env['NODE_ENV'] = original;
      }
    });
  });

  // ── Stress: high-frequency stats sampling ─────────────────────────────────

  describe('stress: repeated stat collection', () => {
    it('should handle 1000 consecutive getRuntimeStats() calls without error', () => {
      for (let i = 0; i < 1_000; i++) {
        const stats = service.getRuntimeStats();
        expect(stats.pid).toBeGreaterThan(0);
      }
    });

    it('should handle 500 metrics snapshot calls without error', () => {
      for (let i = 0; i < 500; i++) {
        metricsStore.gauge(`metric.${i}`, i);
      }
      for (let i = 0; i < 500; i++) {
        const snap = service.getMetricsSnapshot();
        expect(snap).toBeDefined();
      }
    });
  });
});
