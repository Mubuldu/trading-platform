import { CircuitBreaker, CircuitBreakerState } from '@common/resilience/circuit-breaker';
import { CircuitBreakerOpenError } from '@common/errors/infrastructure.error';

const makeBreaker = (
  overrides: Partial<{
    failureThreshold: number;
    successThreshold: number;
    timeoutMs: number;
  }> = {},
): CircuitBreaker =>
  new CircuitBreaker({
    name: 'test-circuit',
    failureThreshold: overrides.failureThreshold ?? 3,
    successThreshold: overrides.successThreshold ?? 2,
    timeoutMs: overrides.timeoutMs ?? 100,
  });

describe('CircuitBreaker', () => {
  describe('CLOSED state', () => {
    it('executes operation normally', async () => {
      const cb = makeBreaker();
      const result = await cb.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('opens after failureThreshold consecutive failures', async () => {
      const cb = makeBreaker({ failureThreshold: 3 });
      const fail = (): Promise<never> => Promise.reject(new Error('fail'));

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(fail)).rejects.toThrow('fail');
      }

      expect(cb.stats.state).toBe(CircuitBreakerState.OPEN);
    });

    it('does not open before threshold', async () => {
      const cb = makeBreaker({ failureThreshold: 3 });
      const fail = (): Promise<never> => Promise.reject(new Error('fail'));

      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.stats.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    async function openBreaker(cb: CircuitBreaker): Promise<void> {
      for (let i = 0; i < 3; i++) {
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
    }

    it('rejects immediately with CircuitBreakerOpenError', async () => {
      const cb = makeBreaker();
      await openBreaker(cb);

      await expect(cb.execute(() => Promise.resolve(1))).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );
    });

    it('transitions to HALF_OPEN after timeout', async () => {
      const cb = makeBreaker({ timeoutMs: 50 });
      await openBreaker(cb);

      await new Promise((r) => setTimeout(r, 60));
      await cb.execute(() => Promise.resolve(1));

      expect(cb.stats.state).not.toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('HALF_OPEN state', () => {
    async function transitionToHalfOpen(cb: CircuitBreaker): Promise<void> {
      for (let i = 0; i < 3; i++) {
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 110));
    }

    it('closes after successThreshold successes', async () => {
      const cb = makeBreaker({ timeoutMs: 100, successThreshold: 2 });
      await transitionToHalfOpen(cb);

      await cb.execute(() => Promise.resolve(1));
      await cb.execute(() => Promise.resolve(2));

      expect(cb.stats.state).toBe(CircuitBreakerState.CLOSED);
    });

    it('re-opens on first failure in HALF_OPEN', async () => {
      const cb = makeBreaker({ timeoutMs: 100 });
      await transitionToHalfOpen(cb);

      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      expect(cb.stats.state).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('onStateChange callback', () => {
    it('fires when state changes', async () => {
      const transitions: Array<[CircuitBreakerState, CircuitBreakerState]> = [];
      const cb = new CircuitBreaker({
        name: 'obs',
        failureThreshold: 2,
        successThreshold: 1,
        timeoutMs: 50,
        onStateChange: (from, to) => transitions.push([from, to]),
      });

      for (let i = 0; i < 2; i++) {
        await cb.execute(() => Promise.reject(new Error())).catch(() => {});
      }

      expect(transitions).toContainEqual([CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN]);
    });
  });

  describe('stats', () => {
    it('tracks total requests and failures', async () => {
      const cb = makeBreaker({ failureThreshold: 10 });
      await cb.execute(() => Promise.resolve(1));
      await cb.execute(() => Promise.reject(new Error())).catch(() => {});

      expect(cb.stats.totalRequests).toBe(2);
      expect(cb.stats.failures).toBe(1);
    });

    it('records lastFailureAt on failure', async () => {
      const cb = makeBreaker({ failureThreshold: 10 });
      await cb.execute(() => Promise.reject(new Error())).catch(() => {});
      expect(cb.stats.lastFailureAt).not.toBeNull();
    });
  });

  describe('reset()', () => {
    it('returns circuit to CLOSED state', async () => {
      const cb = makeBreaker();
      for (let i = 0; i < 3; i++) {
        await cb.execute(() => Promise.reject(new Error())).catch(() => {});
      }
      cb.reset();
      expect(cb.stats.state).toBe(CircuitBreakerState.CLOSED);
    });
  });
});
