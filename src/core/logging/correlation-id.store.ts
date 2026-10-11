import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  readonly correlationId: string;
  readonly requestId: string;
}

/**
 * Process-wide AsyncLocalStorage that propagates the request context across
 * the entire async call chain without parameter threading.
 *
 * Two IDs per request:
 *  - correlationId: distributed trace ID. Accepted from upstream via
 *    x-correlation-id header or generated if absent. Forwarded to downstream
 *    services so a single business transaction can be traced end-to-end.
 *  - requestId: local service ID. Always generated fresh per request. Useful
 *    for deduplication and per-request log correlation within this service.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? 'no-context';
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? 'no-context';
}

export function getCurrentContext(): RequestContext | undefined {
  return storage.getStore();
}
