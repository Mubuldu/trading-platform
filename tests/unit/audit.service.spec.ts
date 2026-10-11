import { AuditService } from '@infrastructure/database/audit/audit.service';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TransactionContext } from '@infrastructure/database/transaction/transaction.context';

describe('AuditService', () => {
  let service: AuditService;
  let poolService: jest.Mocked<PgPoolService>;
  let logger: jest.Mocked<AppLoggerService>;
  let insertSpy: jest.Mock;
  let executespy: jest.Mock;

  beforeEach(() => {
    executespy = jest.fn().mockResolvedValue([]);
    insertSpy = jest
      .fn()
      .mockReturnValue({ values: jest.fn().mockReturnValue({ execute: executespy }) });

    poolService = {
      db: {
        insertInto: insertSpy,
      },
    } as unknown as jest.Mocked<PgPoolService>;

    logger = {
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new AuditService(poolService, logger);
  });

  describe('log()', () => {
    it('writes audit record to audit_logs', async () => {
      await service.log({
        tableName: 'orders',
        recordId: 'order-123',
        operation: 'INSERT',
        actor: 'system',
        newValue: { id: 'order-123' },
      });

      expect(insertSpy).toHaveBeenCalledWith('audit_logs');
      expect(executespy).toHaveBeenCalled();
    });

    it('does not throw when database insert fails', async () => {
      executespy.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.log({ tableName: 'orders', recordId: '1', operation: 'DELETE' }),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });

    it('includes all event fields in the audit record', async () => {
      let capturedValues: unknown;
      const valuesSpy = jest.fn().mockImplementation((v) => {
        capturedValues = v;
        return { execute: executespy };
      });
      insertSpy.mockReturnValue({ values: valuesSpy });

      await service.log({
        tableName: 'positions',
        recordId: 'pos-456',
        operation: 'UPDATE',
        actor: 'strategy-1',
        reason: 'position rebalance',
        oldValue: { qty: 1 },
        newValue: { qty: 2 },
        correlationId: 'corr-789',
      });

      expect(capturedValues).toMatchObject({
        table_name: 'positions',
        record_id: 'pos-456',
        operation: 'UPDATE',
        actor: 'strategy-1',
        reason: 'position rebalance',
        correlation_id: 'corr-789',
      });
    });
  });

  describe('logBatch()', () => {
    it('does nothing for empty array', async () => {
      await service.logBatch([]);
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('inserts all events in a single call', async () => {
      const valuesSpy = jest.fn().mockReturnValue({ execute: executespy });
      insertSpy.mockReturnValue({ values: valuesSpy });

      await service.logBatch([
        { tableName: 'orders', recordId: '1', operation: 'INSERT' },
        { tableName: 'orders', recordId: '2', operation: 'INSERT' },
        { tableName: 'orders', recordId: '3', operation: 'INSERT' },
      ]);

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ record_id: '1' }),
          expect.objectContaining({ record_id: '2' }),
          expect.objectContaining({ record_id: '3' }),
        ]),
      );
    });
  });

  describe('transaction context', () => {
    it('uses transaction when one is active', async () => {
      const trxInsertSpy = jest
        .fn()
        .mockReturnValue({ values: jest.fn().mockReturnValue({ execute: executespy }) });
      const mockTrx = { insertInto: trxInsertSpy } as never;

      await TransactionContext.run(mockTrx, async () => {
        await service.log({ tableName: 'orders', recordId: '1', operation: 'INSERT' });
      });

      expect(trxInsertSpy).toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });
  });
});
