import { Injectable, Inject, NestMiddleware, Optional } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { IMetrics, METRICS_TOKEN } from '@core/metrics/metrics.interface';
import { MetricsCatalog } from '@core/metrics/metrics-catalog';

/**
 * RequestLoggingMiddleware emits structured logs and HTTP metrics for every
 * request.
 *
 * Log events:
 *  INCOMING — logged on request arrival (before any handler runs)
 *  COMPLETED — logged on 'finish' event (after response is fully flushed)
 *
 * Metrics emitted (via IMetrics, tags omitted for brevity):
 *  http.requests.active    — gauge: in-flight request count
 *  http.requests.total     — counter: cumulative requests per method × status
 *  http.request.duration_ms — timing: per method × route × status
 *
 * Route normalization: req.route.path (e.g. /health/live) is preferred over
 * the raw URL so metric keys don't explode with per-ID cardinality. Falls
 * back to a stripped URL path when route matching is unavailable.
 *
 * IMetrics is @Optional() so this middleware remains functional in test
 * environments where MetricsModule is not loaded.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly context = RequestLoggingMiddleware.name;

  constructor(
    private readonly logger: AppLoggerService,
    @Optional() @Inject(METRICS_TOKEN) private readonly metrics?: IMetrics,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = process.hrtime.bigint();
    const { method } = req;
    const rawUrl = req.url ?? '';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

    this.metrics?.increment(MetricsCatalog.HTTP_REQUESTS_ACTIVE);

    this.logger.log(`→ ${method} ${rawUrl} — ${ip} "${userAgent}"`, this.context);

    res.on('finish', () => {
      const durationNs = process.hrtime.bigint() - startTime;
      const durationMs = Number(durationNs / BigInt(1_000_000));
      const { statusCode } = res;
      const route = this.resolveRoute(req, rawUrl);
      const status = String(statusCode);

      this.metrics?.decrement(MetricsCatalog.HTTP_REQUESTS_ACTIVE);
      this.metrics?.increment(MetricsCatalog.HTTP_REQUESTS_TOTAL, 1, { method, status });
      this.metrics?.timing(MetricsCatalog.HTTP_REQUEST_DURATION_MS, durationMs, {
        method,
        route,
        status,
      });

      const logLine = `← ${method} ${rawUrl} ${statusCode} — ${durationMs}ms`;

      if (statusCode >= 500) {
        this.logger.error(logLine, undefined, this.context);
      } else if (statusCode >= 400) {
        this.logger.warn(logLine, this.context);
      } else {
        this.logger.log(logLine, this.context);
      }
    });

    next();
  }

  private resolveRoute(req: Request, rawUrl: string): string {
    const routePath = (req as Request & { route?: { path?: string } }).route?.path;
    if (routePath) return routePath;
    return rawUrl
      .split('?')[0]
      .replace(/\/[0-9a-f-]{36}/gi, '/:id')
      .replace(/\/\d+/g, '/:id');
  }
}
