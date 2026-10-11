import { WsLatencyMonitor } from '@common/websocket/metrics/ws-latency-monitor';

describe('WsLatencyMonitor', () => {
  let monitor: WsLatencyMonitor;

  beforeEach(() => {
    monitor = new WsLatencyMonitor();
  });

  describe('initial state', () => {
    it('returns zero stats when no samples have been recorded', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.networkLatencyMs.sampleCount).toBe(0);
      expect(metrics.processingLatencyMs.sampleCount).toBe(0);
      expect(metrics.messageDelayMs.sampleCount).toBe(0);
      expect(metrics.clockDriftMs).toBe(0);
    });
  });

  describe('recordNetworkLatency', () => {
    it('accumulates samples and computes correct min/max', () => {
      monitor.recordNetworkLatency(10);
      monitor.recordNetworkLatency(20);
      monitor.recordNetworkLatency(30);
      const { networkLatencyMs } = monitor.getMetrics();
      expect(networkLatencyMs.min).toBe(10);
      expect(networkLatencyMs.max).toBe(30);
      expect(networkLatencyMs.avg).toBeCloseTo(20);
      expect(networkLatencyMs.sampleCount).toBe(3);
    });

    it('computes p95 correctly for a small sample', () => {
      for (let i = 1; i <= 100; i++) {
        monitor.recordNetworkLatency(i);
      }
      const { networkLatencyMs } = monitor.getMetrics();
      expect(networkLatencyMs.p95).toBe(95);
    });
  });

  describe('recordProcessingLatency', () => {
    it('tracks independently from networkLatency', () => {
      monitor.recordNetworkLatency(5);
      monitor.recordProcessingLatency(50);
      const metrics = monitor.getMetrics();
      expect(metrics.networkLatencyMs.avg).toBeCloseTo(5);
      expect(metrics.processingLatencyMs.avg).toBeCloseTo(50);
    });
  });

  describe('recordMessageDelay', () => {
    it('positive delay when local receive is after exchange timestamp', () => {
      const exchangeTs = Date.now() - 100;
      monitor.recordMessageDelay(exchangeTs, Date.now());
      const { messageDelayMs } = monitor.getMetrics();
      expect(messageDelayMs.current).toBeGreaterThan(0);
    });

    it('clockDriftMs is rolling average of delay', () => {
      const now = Date.now();
      monitor.recordMessageDelay(now - 100, now);
      monitor.recordMessageDelay(now - 200, now);
      const { clockDriftMs } = monitor.getMetrics();
      expect(clockDriftMs).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('clears all samples', () => {
      monitor.recordNetworkLatency(10);
      monitor.recordProcessingLatency(20);
      monitor.recordMessageDelay(Date.now() - 50, Date.now());
      monitor.reset();
      const metrics = monitor.getMetrics();
      expect(metrics.networkLatencyMs.sampleCount).toBe(0);
      expect(metrics.processingLatencyMs.sampleCount).toBe(0);
      expect(metrics.messageDelayMs.sampleCount).toBe(0);
      expect(metrics.clockDriftMs).toBe(0);
    });
  });
});
