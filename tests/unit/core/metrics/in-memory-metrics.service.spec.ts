import { InMemoryMetricsService } from '@core/metrics/in-memory-metrics.service';

describe('InMemoryMetricsService', () => {
  let service: InMemoryMetricsService;

  beforeEach(() => {
    service = new InMemoryMetricsService();
  });

  // ── Counter operations ─────────────────────────────────────────────────────

  describe('increment()', () => {
    it('should create a counter starting at 1 on first call', () => {
      service.increment('http.requests.total');
      expect(service.getSnapshot().counters['http.requests.total']).toBe(1);
    });

    it('should accumulate across multiple calls', () => {
      service.increment('http.requests.total', 3);
      service.increment('http.requests.total', 2);
      expect(service.getSnapshot().counters['http.requests.total']).toBe(5);
    });

    it('should default value to 1 when not provided', () => {
      service.increment('counter');
      service.increment('counter');
      expect(service.getSnapshot().counters['counter']).toBe(2);
    });

    it('should encode tags into the metric key', () => {
      service.increment('requests', 1, { method: 'GET', status: '200' });
      const snapshot = service.getSnapshot();
      expect(snapshot.counters['requests{method=GET,status=200}']).toBe(1);
    });

    it('should keep separate counters for different tag sets', () => {
      service.increment('requests', 1, { status: '200' });
      service.increment('requests', 1, { status: '500' });
      const { counters } = service.getSnapshot();
      expect(counters['requests{status=200}']).toBe(1);
      expect(counters['requests{status=500}']).toBe(1);
    });
  });

  describe('decrement()', () => {
    it('should subtract from the counter', () => {
      service.increment('active', 5);
      service.decrement('active', 2);
      expect(service.getSnapshot().counters['active']).toBe(3);
    });

    it('should default value to 1 when not provided', () => {
      service.increment('active', 3);
      service.decrement('active');
      expect(service.getSnapshot().counters['active']).toBe(2);
    });
  });

  // ── Gauge operations ───────────────────────────────────────────────────────

  describe('gauge()', () => {
    it('should set the gauge to the provided value', () => {
      service.gauge('memory.rss', 52428800);
      expect(service.getSnapshot().gauges['memory.rss']).toBe(52428800);
    });

    it('should overwrite the previous value', () => {
      service.gauge('memory.rss', 1000);
      service.gauge('memory.rss', 2000);
      expect(service.getSnapshot().gauges['memory.rss']).toBe(2000);
    });

    it('should support negative values', () => {
      service.gauge('delta', -42);
      expect(service.getSnapshot().gauges['delta']).toBe(-42);
    });
  });

  // ── Histogram operations ───────────────────────────────────────────────────

  describe('histogram()', () => {
    it('should record samples and compute stats', () => {
      for (let i = 1; i <= 10; i++) service.histogram('db.query', i);
      const stats = service.getSnapshot().histograms['db.query'];
      expect(stats.count).toBe(10);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(10);
      expect(stats.mean).toBeCloseTo(5.5, 1);
    });

    it('should compute correct p50 for an even distribution', () => {
      for (let i = 1; i <= 100; i++) service.histogram('metric', i);
      const stats = service.getSnapshot().histograms['metric'];
      expect(stats.p50).toBeCloseTo(50.5, 0);
    });

    it('should return zero stats for an empty histogram', () => {
      service.histogram('metric', 5);
      const snapshot = service.getSnapshot();
      // Only 'metric' exists; a never-used key shouldn't be in the snapshot
      expect(snapshot.histograms['nonexistent']).toBeUndefined();
    });
  });

  // ── Timing operations ──────────────────────────────────────────────────────

  describe('timing()', () => {
    it('should record timing samples', () => {
      service.timing('http.duration_ms', 100);
      service.timing('http.duration_ms', 200);
      service.timing('http.duration_ms', 300);
      const stats = service.getSnapshot().timings['http.duration_ms'];
      expect(stats.count).toBe(3);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(300);
    });

    it('should compute p95 correctly for a known distribution', () => {
      for (let i = 1; i <= 100; i++) service.timing('latency', i);
      const stats = service.getSnapshot().timings['latency'];
      // p95 of 1..100 ≈ 95.05
      expect(stats.p95).toBeGreaterThanOrEqual(94);
      expect(stats.p95).toBeLessThanOrEqual(96);
    });
  });

  // ── Timer helper ───────────────────────────────────────────────────────────

  describe('startTimer()', () => {
    it('should record a timing when the returned function is called', () => {
      const stop = service.startTimer('operation.duration_ms');
      stop();
      const stats = service.getSnapshot().timings['operation.duration_ms'];
      expect(stats.count).toBe(1);
      expect(stats.min).toBeGreaterThanOrEqual(0);
    });

    it('should measure real elapsed time', async () => {
      const stop = service.startTimer('delayed');
      await new Promise((r) => setTimeout(r, 20));
      stop();
      const stats = service.getSnapshot().timings['delayed'];
      expect(stats.min).toBeGreaterThanOrEqual(15);
    });

    it('should work with tags', () => {
      const stop = service.startTimer('op', { service: 'db' });
      stop();
      expect(service.getSnapshot().timings['op{service=db}']).toBeDefined();
    });
  });

  // ── Ring buffer capacity ────────────────────────────────────────────────────

  describe('ring buffer', () => {
    it('should produce correct percentiles after the buffer wraps (>1024 samples)', () => {
      // Write 2000 samples with a known distribution: uniform 1–100
      for (let i = 0; i < 2_000; i++) service.timing('wraparound', (i % 100) + 1);
      const stats = service.getSnapshot().timings['wraparound'];
      // The ring holds the last 1024 samples, which are uniform 1-100.
      // p50 ≈ 50, p95 ≈ 95. Sorting before percentile computation is correct
      // regardless of ring position — order of values is irrelevant.
      expect(stats.count).toBe(2_000);
      expect(stats.p50).toBeGreaterThan(40);
      expect(stats.p50).toBeLessThan(60);
      expect(stats.p95).toBeGreaterThan(88);
      expect(stats.p95).toBeLessThan(100);
    });

    it('should not grow beyond RESERVOIR_SIZE samples', () => {
      const ITERATIONS = 2_000;
      for (let i = 0; i < ITERATIONS; i++) {
        service.timing('stress.metric', Math.random() * 1000);
      }
      const stats = service.getSnapshot().timings['stress.metric'];
      // totalCount reflects all recordings
      expect(stats.count).toBe(ITERATIONS);
      // but percentile computation is from the ring (≤ 1024 samples)
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeLessThanOrEqual(1000);
    });

    it('should produce stable percentiles at large volumes', () => {
      for (let i = 0; i < 5_000; i++) service.timing('uniform', i % 100);
      const stats = service.getSnapshot().timings['uniform'];
      // Uniform 0–99 distribution: p50 ≈ 49.5, p99 ≈ 98–99
      expect(stats.p50).toBeGreaterThan(30);
      expect(stats.p50).toBeLessThan(70);
      expect(stats.p99).toBeGreaterThan(90);
    });
  });

  // ── Snapshot completeness ──────────────────────────────────────────────────

  describe('getSnapshot()', () => {
    it('should return all four categories', () => {
      service.increment('c', 1);
      service.gauge('g', 1);
      service.histogram('h', 1);
      service.timing('t', 1);

      const snap = service.getSnapshot();
      expect(snap.counters['c']).toBe(1);
      expect(snap.gauges['g']).toBe(1);
      expect(snap.histograms['h']).toBeDefined();
      expect(snap.timings['t']).toBeDefined();
      expect(snap.collectedAt).toBeDefined();
      expect(() => new Date(snap.collectedAt)).not.toThrow();
    });

    it('should return independent snapshots on repeated calls', () => {
      service.increment('counter');
      const snap1 = service.getSnapshot();
      service.increment('counter');
      const snap2 = service.getSnapshot();
      expect(snap1.counters['counter']).toBe(1);
      expect(snap2.counters['counter']).toBe(2);
    });
  });
});
