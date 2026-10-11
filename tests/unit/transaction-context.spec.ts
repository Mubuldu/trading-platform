import { TransactionContext } from '@infrastructure/database/transaction/transaction.context';

describe('TransactionContext', () => {
  describe('getCurrent()', () => {
    it('returns undefined when no transaction is active', () => {
      expect(TransactionContext.getCurrent()).toBeUndefined();
    });
  });

  describe('isActive()', () => {
    it('returns false when no transaction is active', () => {
      expect(TransactionContext.isActive()).toBe(false);
    });
  });

  describe('run()', () => {
    it('makes transaction available via getCurrent() inside callback', async () => {
      const mockTrx = { id: 'trx-1' } as never;

      let capturedTrx: unknown;
      await TransactionContext.run(mockTrx, async () => {
        capturedTrx = TransactionContext.getCurrent();
      });

      expect(capturedTrx).toBe(mockTrx);
    });

    it('cleans up transaction context after callback resolves', async () => {
      const mockTrx = { id: 'trx-1' } as never;

      await TransactionContext.run(mockTrx, async () => {});

      expect(TransactionContext.getCurrent()).toBeUndefined();
    });

    it('cleans up context even when callback throws', async () => {
      const mockTrx = { id: 'trx-1' } as never;

      await TransactionContext.run(mockTrx, async () => {
        throw new Error('callback error');
      }).catch(() => {});

      expect(TransactionContext.getCurrent()).toBeUndefined();
    });

    it('isActive() returns true inside callback', async () => {
      const mockTrx = { id: 'trx-1' } as never;

      let activeInside = false;
      await TransactionContext.run(mockTrx, async () => {
        activeInside = TransactionContext.isActive();
      });

      expect(activeInside).toBe(true);
    });

    it('returns the callback result', async () => {
      const mockTrx = { id: 'trx-1' } as never;
      const expected = { answer: 42 };

      const result = await TransactionContext.run(mockTrx, async () => expected);

      expect(result).toBe(expected);
    });

    it('supports nested context via AsyncLocalStorage propagation', async () => {
      const outerTrx = { id: 'outer' } as never;
      const innerTrx = { id: 'inner' } as never;

      let innerSaw: unknown;
      let afterInnerSaw: unknown;

      await TransactionContext.run(outerTrx, async () => {
        await TransactionContext.run(innerTrx, async () => {
          innerSaw = TransactionContext.getCurrent();
        });
        afterInnerSaw = TransactionContext.getCurrent();
      });

      expect(innerSaw).toBe(innerTrx);
      expect(afterInnerSaw).toBe(outerTrx);
    });
  });
});
