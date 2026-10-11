export type SpanStatus = 'active' | 'ok' | 'error';

export interface SpanContext {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
}

export interface Span extends SpanContext {
  readonly operationName: string;
  readonly startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  status: SpanStatus;
  readonly tags: Readonly<Record<string, string>>;
}

/**
 * ITracing is the platform-wide distributed tracing interface.
 *
 * Current milestone (M10): lightweight in-process span tracking.
 * The traceId maps to the HTTP correlation ID so spans from the same
 * request are linked without any external propagation.
 *
 * Future: replace TracingService with an OpenTelemetry bridge that
 * emits spans to Jaeger/Zipkin/OTLP. Callers that use this interface
 * need no changes — they simply start/end spans the same way.
 *
 * Span lifecycle:
 *   const span = tracing.startSpan('order.validate', { symbol: 'BTC' });
 *   try {
 *     // ... work ...
 *     tracing.endSpan(span.spanId, 'ok');
 *   } catch (e) {
 *     tracing.endSpan(span.spanId, 'error');
 *     throw e;
 *   }
 */
export interface ITracing {
  startSpan(operationName: string, tags?: Record<string, string>): Span;
  endSpan(spanId: string, status?: 'ok' | 'error'): void;
  getCurrentTraceId(): string;
  getActiveSpans(): readonly Span[];
  getRecentSpans(limit?: number): readonly Span[];
}

export const TRACING_TOKEN = Symbol('ITracing');
