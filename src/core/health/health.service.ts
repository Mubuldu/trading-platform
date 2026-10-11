import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@config/app.config';
import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import { InMemoryMetricsService } from '@core/metrics/in-memory-metrics.service';
import { MetricsCatalog } from '@core/metrics/metrics-catalog';
import { LivenessResponseDto } from './dto/liveness-response.dto';
import { ReadinessResponseDto } from './dto/readiness-response.dto';
import { HealthResponseDto, HealthMetricsDto } from './dto/health-response.dto';

/**
 * HealthService encapsulates all health check logic for the platform.
 *
 * Three tiers of health, each building on the previous:
 *
 *  Liveness  (/live)  — "is the process alive?"
 *    Answers immediately. Checks nothing external. Used by k8s liveness
 *    probe to decide whether to restart the pod.
 *
 *  Readiness (/ready) — "can this pod serve traffic?"
 *    Checks all infrastructure dependencies via HealthCheckRegistry.
 *    Returns 503 when any dependency is unhealthy. Used by k8s readiness
 *    probe to remove/add the pod from load balancer rotation.
 *
 *  Health    (/health) — "what is the full system state?"
 *    Combines liveness, readiness, and a metrics snapshot for dashboards
 *    and monitoring systems. Always returns 200 — status is in the body.
 *
 * Both HealthCheckRegistry and InMemoryMetricsService are injected as
 * @Optional() so this service remains functional in isolation (unit tests,
 * early startup before infrastructure has loaded).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly healthRegistry?: HealthCheckRegistry,
    @Optional() private readonly metricsStore?: InMemoryMetricsService,
  ) {}

  getLiveness(): LivenessResponseDto {
    return {
      status: 'alive',
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<{ response: ReadinessResponseDto; isReady: boolean }> {
    if (!this.healthRegistry) {
      return {
        response: { status: 'ready', checks: {}, timestamp: new Date().toISOString() },
        isReady: true,
      };
    }

    let aggregated: Awaited<ReturnType<typeof this.healthRegistry.runAll>>;
    try {
      aggregated = await this.healthRegistry.runAll();
    } catch {
      return {
        response: {
          status: 'not-ready',
          checks: {
            registry: { status: 'unhealthy', message: 'Health registry threw an exception' },
          },
          timestamp: new Date().toISOString(),
        },
        isReady: false,
      };
    }

    const isReady = aggregated.status !== 'unhealthy';

    const checks = aggregated.checks.reduce<ReadinessResponseDto['checks']>((acc, check) => {
      acc[check.name] = {
        status: check.health.status,
        message: check.health.message,
        latencyMs: check.health.latencyMs,
      };
      return acc;
    }, {});

    return {
      response: {
        status: isReady ? 'ready' : 'not-ready',
        checks,
        timestamp: new Date().toISOString(),
      },
      isReady,
    };
  }

  async getHealth(): Promise<HealthResponseDto> {
    const config = this.configService.get<AppConfig>('app');
    const mem = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    let infrastructureStatus: 'ok' | 'degraded' | 'error' = 'ok';
    let infrastructureChecks: Record<string, unknown> | undefined;

    if (this.healthRegistry) {
      try {
        const aggregated = await this.healthRegistry.runAll();
        infrastructureStatus =
          aggregated.status === 'unhealthy'
            ? 'error'
            : aggregated.status === 'degraded'
              ? 'degraded'
              : 'ok';

        infrastructureChecks = aggregated.checks.reduce<Record<string, unknown>>((acc, check) => {
          acc[check.name] = {
            status: check.health.status,
            message: check.health.message,
            latencyMs: check.health.latencyMs,
          };
          return acc;
        }, {});
      } catch {
        infrastructureStatus = 'error';
        infrastructureChecks = {
          registry: { status: 'unhealthy', message: 'Registry threw an exception' },
        };
      }
    }

    return {
      status: infrastructureStatus === 'error' ? 'error' : 'ok',
      info: {
        application: {
          status: 'up',
          version: config?.version ?? 'unknown',
          environment: config?.environment ?? 'unknown',
        },
        uptime: {
          status: 'up',
          seconds: Math.round(uptimeSeconds * 100) / 100,
        },
        memory: {
          status: 'up',
          metrics: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
          },
        },
      },
      infrastructure: infrastructureChecks,
      metrics: this.buildMetricsDto(mem, uptimeSeconds),
      timestamp: new Date().toISOString(),
    };
  }

  private buildMetricsDto(
    mem: ReturnType<typeof process.memoryUsage>,
    uptimeSeconds: number,
  ): HealthMetricsDto | undefined {
    if (!this.metricsStore) return undefined;

    const snapshot = this.metricsStore.getSnapshot();

    const gcTimings = snapshot.timings[MetricsCatalog.GC_DURATION_MS];
    const gcCounts = Object.entries(snapshot.counters)
      .filter(([k]) => k.startsWith(MetricsCatalog.GC_COUNT))
      .reduce((sum, [, v]) => sum + v, 0);

    const httpTimings = snapshot.timings[MetricsCatalog.HTTP_REQUEST_DURATION_MS];
    const httpTotal = Object.entries(snapshot.counters)
      .filter(([k]) => k.startsWith(MetricsCatalog.HTTP_REQUESTS_TOTAL))
      .reduce((sum, [, v]) => sum + v, 0);

    return {
      uptimeSeconds: Math.round(uptimeSeconds),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      eventLoopLagMs: snapshot.gauges[MetricsCatalog.EVENT_LOOP_LAG_MS],
      httpRequestsTotal: httpTotal > 0 ? httpTotal : undefined,
      httpRequestDurationP95Ms: httpTimings ? Math.round(httpTimings.p95 * 10) / 10 : undefined,
      gcCount: gcCounts > 0 ? gcCounts : undefined,
      gcDurationP95Ms: gcTimings ? Math.round(gcTimings.p95 * 10) / 10 : undefined,
    };
  }
}
