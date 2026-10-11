import {
  getCorrelationId,
  getRequestId,
  getCurrentContext,
  runWithContext,
  RequestContext,
} from '@core/logging/correlation-id.store';

function ctx(correlationId: string, requestId = 'req-default'): RequestContext {
  return { correlationId, requestId };
}

describe('CorrelationIdStore', () => {
  describe('runWithContext', () => {
    it('should make correlationId available inside the context', () => {
      const id = 'test-correlation-id-123';
      let captured: string | undefined;

      runWithContext(ctx(id), () => {
        captured = getCorrelationId();
      });

      expect(captured).toBe(id);
    });

    it('should make requestId available inside the context', () => {
      let captured: string | undefined;

      runWithContext(ctx('cid', 'rid-abc'), () => {
        captured = getRequestId();
      });

      expect(captured).toBe('rid-abc');
    });

    it('should return the value produced by the wrapped function', () => {
      const result = runWithContext(ctx('some-id'), () => 42);
      expect(result).toBe(42);
    });

    it('should isolate contexts between concurrent async operations', async () => {
      const results: string[] = [];

      await Promise.all([
        new Promise<void>((resolve) => {
          runWithContext(ctx('context-A'), async () => {
            await new Promise((r) => setTimeout(r, 10));
            results.push(getCorrelationId());
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          runWithContext(ctx('context-B'), async () => {
            await new Promise((r) => setTimeout(r, 5));
            results.push(getCorrelationId());
            resolve();
          });
        }),
      ]);

      expect(results).toContain('context-A');
      expect(results).toContain('context-B');
      expect(results).toHaveLength(2);
    });

    it('should support nested contexts (inner wins)', () => {
      let innerId: string | undefined;
      let outerIdAfter: string | undefined;

      runWithContext(ctx('outer'), () => {
        runWithContext(ctx('inner'), () => {
          innerId = getCorrelationId();
        });
        outerIdAfter = getCorrelationId();
      });

      expect(innerId).toBe('inner');
      expect(outerIdAfter).toBe('outer');
    });
  });

  describe('getCorrelationId', () => {
    it('should return "no-context" when called outside a context', () => {
      expect(getCorrelationId()).toBe('no-context');
    });
  });

  describe('getRequestId', () => {
    it('should return "no-context" when called outside a context', () => {
      expect(getRequestId()).toBe('no-context');
    });
  });

  describe('getCurrentContext', () => {
    it('should return undefined outside a context', () => {
      expect(getCurrentContext()).toBeUndefined();
    });

    it('should return the full context object inside a context', () => {
      let captured: ReturnType<typeof getCurrentContext>;

      runWithContext(ctx('ctx-id', 'req-id'), () => {
        captured = getCurrentContext();
      });

      expect(captured).toEqual({ correlationId: 'ctx-id', requestId: 'req-id' });
    });
  });
});
