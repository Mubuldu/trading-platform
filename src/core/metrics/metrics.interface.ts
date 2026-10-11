/**
 * IMetrics is the platform-wide metrics interface.
 *
 * No Prometheus, Datadog, or CloudWatch coupling exists in this milestone.
 * The platform emits metrics through this interface; a future MetricsModule
 * will provide a concrete implementation that pushes to the chosen backend.
 *
 * This design ensures:
 *  - Zero additional latency in tests (NoopMetricsService does nothing)
 *  - Backend can be swapped or added without touching calling code
 *  - Multiple backends can be composed (e.g. Prometheus + Datadog) via a
 *    CompositeMetricsService that delegates to both
 *
 * Tag conventions:
 *  Tags are key-value pairs for dimensional slicing.
 *  Use snake_case keys. Examples: service, exchange, symbol, strategy_id.
 *  Keep cardinality low — never use order IDs or request IDs as tag values.
 */
export interface IMetrics {
  increment(metric: string, value?: number, tags?: Record<string, string>): void;
  decrement(metric: string, value?: number, tags?: Record<string, string>): void;
  gauge(metric: string, value: number, tags?: Record<string, string>): void;
  histogram(metric: string, value: number, tags?: Record<string, string>): void;
  timing(metric: string, durationMs: number, tags?: Record<string, string>): void;

  /**
   * Starts a timer and returns a function that, when called, records the
   * elapsed time as a timing metric. Always call the returned function —
   * even on error paths — to prevent metric leaks.
   *
   * Usage:
   *   const stop = metrics.startTimer('order.execution.duration', { symbol: 'BTC' });
   *   try { ... } finally { stop(); }
   */
  startTimer(metric: string, tags?: Record<string, string>): () => void;
}

export const METRICS_TOKEN = Symbol('IMetrics');
