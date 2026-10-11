import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ITracing, Span, SpanStatus } from './tracing.interface';
import { getCorrelationId } from '@core/logging/correlation-id.store';

const MAX_COMPLETED_SPANS = 256;

/**
 * TracingService provides lightweight in-process span tracking.
 *
 * Each span carries:
 *  - traceId  : the HTTP correlation ID (propagated across service boundaries
 *               via the x-correlation-id header, already handled by middleware)
 *  - spanId   : unique per span (UUIDv4)
 *  - parentSpanId: optional; set by the caller to chain spans within a trace
 *
 * Active spans are kept in a Map for O(1) lookup by spanId.
 * Completed spans are stored in a fixed-capacity ring (256 entries) so recent
 * request traces are available for diagnostics without unbounded memory growth.
 *
 * Future OpenTelemetry migration:
 *  Implement ITracing with an OTel TracerProvider and register it under
 *  TRACING_TOKEN. This service is then removed. No caller changes required.
 */
@Injectable()
export class TracingService implements ITracing {
  private readonly active = new Map<string, Span>();
  private readonly completed: Span[] = [];

  startSpan(operationName: string, tags?: Record<string, string>): Span {
    const span: Span = {
      spanId: uuidv4(),
      traceId: getCorrelationId(),
      operationName,
      startTimeMs: Date.now(),
      status: 'active' as SpanStatus,
      tags: { ...tags },
    };
    this.active.set(span.spanId, span);
    return span;
  }

  endSpan(spanId: string, status: 'ok' | 'error' = 'ok'): void {
    const span = this.active.get(spanId);
    if (!span) return;
    this.active.delete(spanId);

    const endTimeMs = Date.now();
    const finished: Span = {
      ...span,
      endTimeMs,
      durationMs: endTimeMs - span.startTimeMs,
      status,
    };

    if (this.completed.length >= MAX_COMPLETED_SPANS) {
      this.completed.shift();
    }
    this.completed.push(finished);
  }

  getCurrentTraceId(): string {
    return getCorrelationId();
  }

  getActiveSpans(): readonly Span[] {
    return [...this.active.values()];
  }

  getRecentSpans(limit = 50): readonly Span[] {
    const start = Math.max(0, this.completed.length - limit);
    return this.completed.slice(start);
  }
}
