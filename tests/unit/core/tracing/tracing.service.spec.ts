import { TracingService } from '@core/tracing/tracing.service';
import { runWithContext } from '@core/logging/correlation-id.store';

describe('TracingService', () => {
  let service: TracingService;

  beforeEach(() => {
    service = new TracingService();
  });

  // ── Span lifecycle ─────────────────────────────────────────────────────────

  describe('startSpan()', () => {
    it('should create a span with the given operation name', () => {
      runWithContext({ correlationId: 'cid-1', requestId: 'rid-1' }, () => {
        const span = service.startSpan('order.validate');
        expect(span.operationName).toBe('order.validate');
      });
    });

    it('should set status to "active"', () => {
      runWithContext({ correlationId: 'cid-2', requestId: 'rid-2' }, () => {
        const span = service.startSpan('op');
        expect(span.status).toBe('active');
      });
    });

    it('should set traceId from the current correlationId', () => {
      runWithContext({ correlationId: 'trace-xyz', requestId: 'rid-3' }, () => {
        const span = service.startSpan('op');
        expect(span.traceId).toBe('trace-xyz');
      });
    });

    it('should generate a unique spanId', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const s1 = service.startSpan('a');
        const s2 = service.startSpan('b');
        expect(s1.spanId).not.toBe(s2.spanId);
      });
    });

    it('should attach provided tags', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op', { symbol: 'BTC', exchange: 'binance' });
        expect(span.tags['symbol']).toBe('BTC');
        expect(span.tags['exchange']).toBe('binance');
      });
    });

    it('should add the span to active spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        service.startSpan('op');
        expect(service.getActiveSpans()).toHaveLength(1);
      });
    });
  });

  describe('endSpan()', () => {
    it('should remove the span from active spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op');
        service.endSpan(span.spanId);
        expect(service.getActiveSpans()).toHaveLength(0);
      });
    });

    it('should move the span to completed spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op');
        service.endSpan(span.spanId, 'ok');
        expect(service.getRecentSpans()).toHaveLength(1);
        expect(service.getRecentSpans()[0].status).toBe('ok');
      });
    });

    it('should record endTimeMs and durationMs', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op');
        service.endSpan(span.spanId);
        const completed = service.getRecentSpans()[0];
        expect(completed.endTimeMs).toBeDefined();
        expect(completed.durationMs).toBeGreaterThanOrEqual(0);
      });
    });

    it('should default status to "ok" when not specified', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op');
        service.endSpan(span.spanId);
        expect(service.getRecentSpans()[0].status).toBe('ok');
      });
    });

    it('should record "error" status when specified', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        const span = service.startSpan('op');
        service.endSpan(span.spanId, 'error');
        expect(service.getRecentSpans()[0].status).toBe('error');
      });
    });

    it('should silently ignore unknown spanIds', () => {
      expect(() => service.endSpan('nonexistent-id')).not.toThrow();
    });
  });

  // ── Span queries ───────────────────────────────────────────────────────────

  describe('getActiveSpans()', () => {
    it('should return an empty array when no spans are active', () => {
      expect(service.getActiveSpans()).toHaveLength(0);
    });

    it('should return all active spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        service.startSpan('a');
        service.startSpan('b');
        expect(service.getActiveSpans()).toHaveLength(2);
      });
    });
  });

  describe('getRecentSpans()', () => {
    it('should respect the limit parameter', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        for (let i = 0; i < 10; i++) {
          const s = service.startSpan(`op-${i}`);
          service.endSpan(s.spanId);
        }
        expect(service.getRecentSpans(5)).toHaveLength(5);
      });
    });

    it('should return the most recent spans when limit is set', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        for (let i = 0; i < 10; i++) {
          const s = service.startSpan(`op-${i}`);
          service.endSpan(s.spanId);
        }
        const recent = service.getRecentSpans(3);
        expect(recent[recent.length - 1].operationName).toBe('op-9');
      });
    });
  });

  // ── Ring buffer eviction ───────────────────────────────────────────────────

  describe('completed spans ring buffer', () => {
    it('should not hold more than 256 completed spans', () => {
      runWithContext({ correlationId: 'cid', requestId: 'rid' }, () => {
        for (let i = 0; i < 300; i++) {
          const s = service.startSpan(`op-${i}`);
          service.endSpan(s.spanId);
        }
        // getRecentSpans(300) asks for up to 256
        expect(service.getRecentSpans(300).length).toBeLessThanOrEqual(256);
      });
    });
  });

  // ── Trace ID ───────────────────────────────────────────────────────────────

  describe('getCurrentTraceId()', () => {
    it('should return the current correlationId', () => {
      runWithContext({ correlationId: 'current-trace', requestId: 'rid' }, () => {
        expect(service.getCurrentTraceId()).toBe('current-trace');
      });
    });

    it('should return "no-context" outside a request context', () => {
      expect(service.getCurrentTraceId()).toBe('no-context');
    });
  });
});
