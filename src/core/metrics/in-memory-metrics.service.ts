import { Injectable } from '@nestjs/common';
import { IMetrics } from './metrics.interface';

const RESERVOIR_SIZE = 1_024;

export interface HistogramStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
  readonly p99: number;
}

export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramStats>>;
  readonly timings: Readonly<Record<string, HistogramStats>>;
  readonly collectedAt: string;
}

interface RingBuffer {
  readonly data: Float64Array;
  writePos: number;
  totalCount: number;
}

function makeRing(): RingBuffer {
  return { data: new Float64Array(RESERVOIR_SIZE), writePos: 0, totalCount: 0 };
}

function ringRecord(buf: RingBuffer, value: number): void {
  buf.data[buf.writePos] = value;
  buf.writePos = (buf.writePos + 1) % RESERVOIR_SIZE;
  buf.totalCount++;
}

function ringStats(buf: RingBuffer): HistogramStats {
  const filled = Math.min(buf.totalCount, RESERVOIR_SIZE);
  if (filled === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p75: 0, p95: 0, p99: 0 };
  }
  const sorted = Array.from(buf.data.subarray(0, filled)).sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: buf.totalCount,
    min: sorted[0],
    max: sorted[filled - 1],
    mean: sum / filled,
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

/**
 * InMemoryMetricsService is the production in-process metrics store.
 *
 * Design:
 *  - Counters and gauges use plain Map<string, number> — O(1) reads/writes.
 *  - Histograms and timings use a fixed-capacity ring buffer (Float64Array)
 *    that overwrites oldest samples once full. Percentiles are computed from
 *    the last RESERVOIR_SIZE (1024) samples at read time, not write time.
 *  - Tag encoding: tags are serialised as sorted key=value pairs appended to
 *    the metric name so dimensional metrics share the same map with no special
 *    structure needed by the callers.
 *
 * Thread safety: Node.js is single-threaded; no locks are required.
 *
 * Memory bound: each ring buffer holds 1024 × 8 bytes = 8 KB. A platform
 * with 50 distinct timing metrics uses ~400 KB total — negligible.
 *
 * Extension: when Prometheus is added, this class is kept as-is for the
 * in-process snapshot API. A PrometheusMetricsService is registered under
 * METRICS_TOKEN instead, implementing the same IMetrics interface.
 */
@Injectable()
export class InMemoryMetricsService implements IMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, RingBuffer>();
  private readonly timings = new Map<string, RingBuffer>();

  increment(metric: string, value = 1, tags?: Record<string, string>): void {
    const k = this.key(metric, tags);
    this.counters.set(k, (this.counters.get(k) ?? 0) + value);
  }

  decrement(metric: string, value = 1, tags?: Record<string, string>): void {
    const k = this.key(metric, tags);
    this.counters.set(k, (this.counters.get(k) ?? 0) - value);
  }

  gauge(metric: string, value: number, tags?: Record<string, string>): void {
    this.gauges.set(this.key(metric, tags), value);
  }

  histogram(metric: string, value: number, tags?: Record<string, string>): void {
    const k = this.key(metric, tags);
    let buf = this.histograms.get(k);
    if (!buf) {
      buf = makeRing();
      this.histograms.set(k, buf);
    }
    ringRecord(buf, value);
  }

  timing(metric: string, durationMs: number, tags?: Record<string, string>): void {
    const k = this.key(metric, tags);
    let buf = this.timings.get(k);
    if (!buf) {
      buf = makeRing();
      this.timings.set(k, buf);
    }
    ringRecord(buf, durationMs);
  }

  startTimer(metric: string, tags?: Record<string, string>): () => void {
    const start = process.hrtime.bigint();
    return (): void => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.timing(metric, durationMs, tags);
    };
  }

  getSnapshot(): MetricsSnapshot {
    const histogramStats: Record<string, HistogramStats> = {};
    for (const [k, buf] of this.histograms) histogramStats[k] = ringStats(buf);

    const timingStats: Record<string, HistogramStats> = {};
    for (const [k, buf] of this.timings) timingStats[k] = ringStats(buf);

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats,
      timings: timingStats,
      collectedAt: new Date().toISOString(),
    };
  }

  private key(metric: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return metric;
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${metric}{${tagStr}}`;
  }
}
