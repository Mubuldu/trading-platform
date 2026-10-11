import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as v8 from 'v8';
import { PerformanceObserver } from 'perf_hooks';
import { IMetrics, METRICS_TOKEN } from './metrics.interface';
import { MetricsCatalog } from './metrics-catalog';
import { MonitoringConfig } from '@config/monitoring.config';

interface GcDetail {
  kind?: number;
}

/**
 * RuntimeStatsCollector periodically samples system-level metrics and pushes
 * them through IMetrics. It is the only place in the platform that directly
 * reads process/v8 internals — all other code goes through the IMetrics
 * abstraction.
 *
 * Collected metrics:
 *  - Process memory (RSS, heap used/total, external)
 *  - CPU usage (user and system, as delta ms and percent since last sample)
 *  - V8 heap statistics (used, total, limit, available, malloced)
 *  - Garbage collection (duration histogram and count, per GC kind)
 *  - Event loop lag (ms delay beyond the scheduled callback interval)
 *  - Process uptime (seconds)
 *
 * All timers use .unref() so they do not prevent graceful shutdown.
 *
 * GC observation uses PerformanceObserver which may not be available in all
 * environments (e.g. certain stripped Node.js builds). The setup is wrapped in
 * try/catch and silently skipped on failure.
 */
@Injectable()
export class RuntimeStatsCollector implements OnModuleInit, OnModuleDestroy {
  private collectionTimer: ReturnType<typeof setInterval> | null = null;
  private lagTimer: ReturnType<typeof setTimeout> | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private isDestroyed = false;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleAt = Date.now();

  constructor(
    private readonly configService: ConfigService,
    @Inject(METRICS_TOKEN) private readonly metrics: IMetrics,
  ) {}

  onModuleInit(): void {
    const config = this.configService.get<MonitoringConfig>('monitoring');
    const intervalMs = config?.metrics.collectionIntervalMs ?? 15_000;

    this.setupGcObserver();
    this.startEventLoopLagTracking();
    this.collect();

    this.collectionTimer = setInterval(() => this.collect(), intervalMs);
    this.collectionTimer.unref();
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    if (this.lagTimer) {
      clearTimeout(this.lagTimer);
      this.lagTimer = null;
    }
    this.gcObserver?.disconnect();
    this.gcObserver = null;
  }

  private collect(): void {
    this.collectMemory();
    this.collectCpu();
    this.collectHeap();
    this.metrics.gauge(MetricsCatalog.PROCESS_UPTIME_SECONDS, process.uptime());
  }

  private collectMemory(): void {
    const mem = process.memoryUsage();
    this.metrics.gauge(MetricsCatalog.PROCESS_MEMORY_RSS, mem.rss);
    this.metrics.gauge(MetricsCatalog.PROCESS_MEMORY_HEAP_USED, mem.heapUsed);
    this.metrics.gauge(MetricsCatalog.PROCESS_MEMORY_HEAP_TOTAL, mem.heapTotal);
    this.metrics.gauge(MetricsCatalog.PROCESS_MEMORY_EXTERNAL, mem.external);
  }

  private collectCpu(): void {
    const now = Date.now();
    const elapsed = now - this.lastCpuSampleAt;
    if (elapsed <= 0) return;

    const delta = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;

    const userMs = delta.user / 1_000;
    const systemMs = delta.system / 1_000;
    this.metrics.gauge(MetricsCatalog.PROCESS_CPU_USER_MS, userMs);
    this.metrics.gauge(MetricsCatalog.PROCESS_CPU_SYSTEM_MS, systemMs);
    this.metrics.gauge(MetricsCatalog.PROCESS_CPU_USER_PERCENT, (userMs / elapsed) * 100);
    this.metrics.gauge(MetricsCatalog.PROCESS_CPU_SYSTEM_PERCENT, (systemMs / elapsed) * 100);
  }

  private collectHeap(): void {
    const heap = v8.getHeapStatistics();
    this.metrics.gauge(MetricsCatalog.V8_HEAP_USED, heap.used_heap_size);
    this.metrics.gauge(MetricsCatalog.V8_HEAP_TOTAL, heap.total_heap_size);
    this.metrics.gauge(MetricsCatalog.V8_HEAP_LIMIT, heap.heap_size_limit);
    this.metrics.gauge(MetricsCatalog.V8_HEAP_AVAILABLE, heap.total_available_size);
    this.metrics.gauge(MetricsCatalog.V8_MALLOCED_MEMORY, heap.malloced_memory);
  }

  private setupGcObserver(): void {
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const detail = (entry as unknown as { detail?: GcDetail }).detail;
          const kind = String(detail?.kind ?? 'unknown');
          this.metrics.timing(MetricsCatalog.GC_DURATION_MS, entry.duration, { kind });
          this.metrics.increment(MetricsCatalog.GC_COUNT, 1, { kind });
        }
      });
      this.gcObserver.observe({ type: 'gc' });
    } catch {
      // GC observation not supported in this environment — no-op
    }
  }

  private startEventLoopLagTracking(): void {
    const INTERVAL_MS = 1_000;

    const tick = (): void => {
      if (this.isDestroyed) return;
      const expected = Date.now() + INTERVAL_MS;
      this.lagTimer = setTimeout(() => {
        const lag = Math.max(0, Date.now() - expected);
        this.metrics.gauge(MetricsCatalog.EVENT_LOOP_LAG_MS, lag);
        tick();
      }, INTERVAL_MS);
      this.lagTimer.unref();
    };

    tick();
  }
}
