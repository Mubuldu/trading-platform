import { TransactionManager } from '@infrastructure/database/transaction/transaction-manager.service';
import { TransactionContext } from '@infrastructure/database/transaction/transaction.context';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { DatabaseError } from '@common/errors/infrastructure.error';

describe('TransactionManager', () => {
  let manager: TransactionManager;
  let poolService: jest.Mocked<PgPoolService>;
  let logger: jest.Mocked<AppLoggerService>;
  let mockTrx: { executeQuery: jest.Mock; raw: jest.Mock };
  let transactionExecuteSpy: jest.Mock;

  beforeEach(() => {
    mockTrx = {
      executeQuery: jest.fn(),
      raw: jest.fn().mockReturnValue({ compile: () => ({}) }),
    };

    transactionExecuteSpy = jest.fn();

    poolService = {
      db: {
        transaction: () => ({
          setIsolationLevel: () => ({
            execute: transactionExecuteSpy,
          }),
        }),
      },
    } as unknown as jest.Mocked<PgPoolService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    manager = new TransactionManager(poolService, logger);
  });

  afterEach(() => {
    // Clean up AsyncLocalStorage to avoid test pollution
    jest.restoreAllMocks();
  });

  describe('run()', () => {
    it('executes callback inside transaction', async () => {
      const callbackResult = { success: true };
      transactionExecuteSpy.mockImplementationOnce(
        async (callback: (trx: typeof mockTrx) => Promise<unknown>) => {
          return TransactionContext.run(mockTrx as never, () => callback(mockTrx as never));
        },
      );

      const callback = jest.fn().mockResolvedValue(callbackResult);

      const result = await manager.run(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toBe(callbackResult);
    });

    it('propagates callback errors', async () => {
      const error = new DatabaseError('constraint violation');
      transactionExecuteSpy.mockRejectedValueOnce(error);

      await expect(manager.run(() => Promise.reject(error))).rejects.toBeInstanceOf(DatabaseError);
    });

    it('retries on serialization failure (code 40001)', async () => {
      const serializationError = Object.assign(new Error('serialization failure'), {
        code: '40001',
      });
      const successResult = 'done';

      let attempt = 0;
      transactionExecuteSpy.mockImplementation(async (callback: () => Promise<unknown>) => {
        attempt++;
        if (attempt === 1) throw serializationError;
        return callback();
      });

      const callback = jest.fn().mockResolvedValue(successResult);

      const result = await manager.run(callback, { maxRetries: 1 });

      expect(result).toBe(successResult);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('40001'),
        expect.any(String),
      );
    });

    it('does not retry beyond maxRetries', async () => {
      const serializationError = Object.assign(new Error('serialization failure'), {
        code: '40001',
      });
      transactionExecuteSpy.mockRejectedValue(serializationError);

      await expect(manager.run(() => Promise.resolve(), { maxRetries: 2 })).rejects.toBeDefined();
      expect(transactionExecuteSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('joins existing transaction as savepoint when already in transaction', async () => {
      mockTrx.executeQuery.mockResolvedValue({});

      let innerResult: unknown;
      transactionExecuteSpy.mockImplementationOnce(
        async (callback: (trx: typeof mockTrx) => Promise<unknown>) => {
          return TransactionContext.run(mockTrx as never, async () => {
            // Now we're in a transaction вЂ” run() should use savepoint
            innerResult = await manager.run(async () => {
              return TransactionContext.isActive();
            });
            return callback(mockTrx as never);
          });
        },
      );

      await manager.run(async () => {});

      expect(innerResult).toBe(true);
    });
  });
});
