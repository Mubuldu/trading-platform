import { Global, Module } from '@nestjs/common';
import { InMemoryMetricsService } from './in-memory-metrics.service';
import { RuntimeStatsCollector } from './runtime-stats-collector.service';
import { METRICS_TOKEN } from './metrics.interface';

/**
 * MetricsModule provides the IMetrics implementation globally.
 *
 * Current implementation: InMemoryMetricsService — an in-process ring-buffer
 * store that supports counters, gauges, histograms, and timings. Its
 * getSnapshot() API is used by the health and diagnostics endpoints.
 *
 * Prometheus migration path:
 *  1. Create PrometheusMetricsService implementing IMetrics.
 *  2. Change `useExisting` below to `useClass: PrometheusMetricsService`.
 *  3. Add a /metrics endpoint that calls prometheus.register.metrics().
 *  No other files need to change — all callers inject METRICS_TOKEN.
 *
 * RuntimeStatsCollector is started automatically on module init and collects
 * process/v8/GC/event-loop metrics on the configured interval.
 */
@Global()
@Module({
  providers: [
    InMemoryMetricsService,
    {
      provide: METRICS_TOKEN,
      useExisting: InMemoryMetricsService,
    },
    RuntimeStatsCollector,
  ],
  exports: [METRICS_TOKEN, InMemoryMetricsService, RuntimeStatsCollector],
})
export class MetricsModule {}
