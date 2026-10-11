import { Injectable, Optional } from '@nestjs/common';
import * as v8 from 'v8';
import { InMemoryMetricsService } from '@core/metrics/in-memory-metrics.service';
import { TracingService } from '@core/tracing/tracing.service';
import { RuntimeStatsDto } from './dto/diagnostics-response.dto';

type ProcessWithInternals = {
  _getActiveHandles(): unknown[];
  _getActiveRequests(): unknown[];
};

/**
 * DiagnosticsService exposes deep runtime state for debugging and profiling.
 *
 * Heap snapshots write to the OS temp directory and can be loaded in Chrome
 * DevTools Memory tab or the Node.js Heap Profiler. In production, snapshots
 * are disabled to prevent the ~1s GC pause that occurs during capture.
 *
 * Active handle/request counts use Node.js private APIs (_getActiveHandles,
 * _getActiveRequests). These are diagnostic-only APIs available since Node.js
 * 0.9 and present through Node.js 20+. They return -1 if unavailable.
 *
 * Security: the heap snapshot endpoint is disabled in production and should
 * sit behind authentication in staging environments.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    @Optional() private readonly metricsStore?: InMemoryMetricsService,
    @Optional() private readonly tracingService?: TracingService,
  ) {}

  getRuntimeStats(): RuntimeStatsDto {
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const cpu = process.cpuUsage();

    return {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime() * 100) / 100,
      environment: process.env['NODE_ENV'] ?? 'unknown',
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
      },
      heap: {
        usedBytes: heap.used_heap_size,
        totalBytes: heap.total_heap_size,
        limitBytes: heap.heap_size_limit,
        availableBytes: heap.total_available_size,
      },
      cpu: {
        userMs: cpu.user / 1_000,
        systemMs: cpu.system / 1_000,
      },
      handles: {
        activeHandles: this.getActiveHandleCount(),
        activeRequests: this.getActiveRequestCount(),
      },
    };
  }

  getMetricsSnapshot(): Record<string, unknown> {
    if (!this.metricsStore) return {};
    return this.metricsStore.getSnapshot() as unknown as Record<string, unknown>;
  }

  getActiveSpans(): unknown[] {
    return this.tracingService ? [...this.tracingService.getActiveSpans()] : [];
  }

  getRecentSpans(limit = 50): unknown[] {
    return this.tracingService ? [...this.tracingService.getRecentSpans(limit)] : [];
  }

  triggerHeapSnapshot(): string {
    return v8.writeHeapSnapshot();
  }

  isProductionEnvironment(): boolean {
    return process.env['NODE_ENV'] === 'production';
  }

  private getActiveHandleCount(): number {
    try {
      return (process as unknown as ProcessWithInternals)._getActiveHandles().length;
    } catch {
      return -1;
    }
  }

  private getActiveRequestCount(): number {
    try {
      return (process as unknown as ProcessWithInternals)._getActiveRequests().length;
    } catch {
      return -1;
    }
  }
}
