import { PgBaseRepository } from '@infrastructure/database/repository/base/pg-base.repository';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AuditService } from '@infrastructure/database/audit/audit.service';
import { TransactionContext } from '@infrastructure/database/transaction/transaction.context';

// Concrete test subclass
class TestRepository extends PgBaseRepository<'assets'> {
  protected readonly tableName = 'assets' as const;

  findById(id: string) {
    return this._findById(id);
  }
  findAll() {
    return this._findAll();
  }
  insert(values: Record<string, unknown>) {
    return this._insert(values);
  }
  update(id: string, values: Record<string, unknown>) {
    return this._update(id, values);
  }
  softDelete(id: string) {
    return this._softDelete(id);
  }
  exists(id: string) {
    return this._exists(id);
  }
}

describe('PgBaseRepository', () => {
  let repo: TestRepository;
  let poolService: jest.Mocked<PgPoolService>;
  let auditService: jest.Mocked<AuditService>;
  let mockDb: Record<string, any>;

  const buildQueryChain = (result: unknown) => {
    const chain: Record<string, any> = {};
    const methods = [
      'selectFrom',
      'selectAll',
      'where',
      'orderBy',
      'limit',
      'offset',
      'insertInto',
      'values',
      'returningAll',
      'updateTable',
      'set',
      'deleteFrom',
      'select',
      'fn',
    ];
    methods.forEach((m) => {
      chain[m] = jest.fn().mockReturnValue(chain);
    });
    chain['executeTakeFirst'] = jest.fn().mockResolvedValue(result);
    chain['executeTakeFirstOrThrow'] = jest.fn().mockResolvedValue(result);
    chain['execute'] = jest.fn().mockResolvedValue(Array.isArray(result) ? result : [result]);
    chain['countAll'] = jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue(chain) });
    chain['fn'] = { countAll: chain['countAll'] };
    return chain;
  };

  beforeEach(() => {
    mockDb = buildQueryChain(null);

    poolService = {
      db: mockDb,
    } as unknown as jest.Mocked<PgPoolService>;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logBatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    repo = new TestRepository(poolService, auditService);
  });

  describe('db getter', () => {
    it('returns pool.db when no transaction is active', () => {
      expect((repo as unknown as { db: unknown }).db).toBe(mockDb);
    });

    it('returns transaction when one is active', async () => {
      const mockTrx = buildQueryChain(null);
      let capturedDb: unknown;

      await TransactionContext.run(mockTrx as never, async () => {
        capturedDb = (repo as unknown as { db: unknown }).db;
      });

      expect(capturedDb).toBe(mockTrx);
    });
  });

  describe('_findById()', () => {
    it('returns NotFoundError when row is not found', async () => {
      mockDb['executeTakeFirst'].mockResolvedValueOnce(undefined);

      const result = await repo.findById('nonexistent');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('returns ok with row when found', async () => {
      const row = { id: 'asset-1', symbol: 'BTC', name: 'Bitcoin' };
      mockDb['executeTakeFirst'].mockResolvedValueOnce(row);

      const result = await repo.findById('asset-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(row);
      }
    });

    it('returns DatabaseError on query failure', async () => {
      mockDb['executeTakeFirst'].mockRejectedValueOnce(new Error('pg error'));

      const result = await repo.findById('id-1');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('pg error');
      }
    });
  });

  describe('_insert()', () => {
    it('returns inserted row and calls audit.log', async () => {
      const inserted = { id: 'asset-2', symbol: 'ETH', name: 'Ethereum' };
      mockDb['executeTakeFirstOrThrow'].mockResolvedValueOnce(inserted);

      const result = await repo.insert({ symbol: 'ETH', name: 'Ethereum' });

      expect(result.isOk()).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'INSERT', recordId: 'asset-2' }),
      );
    });

    it('returns DatabaseError on insert failure', async () => {
      mockDb['executeTakeFirstOrThrow'].mockRejectedValueOnce(new Error('unique violation'));

      const result = await repo.insert({ symbol: 'ETH' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('unique violation');
      }
    });
  });

  describe('_update()', () => {
    it('returns NotFoundError when no row matches', async () => {
      mockDb['executeTakeFirst'].mockResolvedValueOnce(undefined);

      const result = await repo.update('nonexistent', { name: 'New' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('returns updated row and logs audit event', async () => {
      const updated = { id: 'asset-1', symbol: 'BTC', name: 'Updated' };
      mockDb['executeTakeFirst'].mockResolvedValueOnce(updated);

      const result = await repo.update('asset-1', { name: 'Updated' });

      expect(result.isOk()).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'UPDATE', recordId: 'asset-1' }),
      );
    });
  });

  describe('_softDelete()', () => {
    it('finds row first then soft-deletes and logs audit', async () => {
      const existing = { id: 'asset-1', deleted_at: null };
      mockDb['executeTakeFirst'].mockResolvedValueOnce(existing);
      mockDb['execute'].mockResolvedValueOnce([]);

      const result = await repo.softDelete('asset-1');

      expect(result.isOk()).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'DELETE', recordId: 'asset-1' }),
      );
    });

    it('returns NotFoundError when row does not exist', async () => {
      mockDb['executeTakeFirst'].mockResolvedValueOnce(undefined);

      const result = await repo.softDelete('nonexistent');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('_insertMany()', () => {
    it('returns ok([]) for empty array without querying db', async () => {
      const result = await (
        repo as unknown as { _insertMany: (values: unknown[]) => Promise<unknown> }
      )._insertMany([]);

      expect(result).toMatchObject({ _tag: 'ok' });
      expect(mockDb['insertInto']).not.toHaveBeenCalled();
    });
  });
});
