import { OrderRepository } from '@infrastructure/database/repository/order.repository';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AuditService } from '@infrastructure/database/audit/audit.service';

const buildDbChain = (resolveWith: unknown = null) => {
  const chain: Record<string, any> = {};
  [
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
    'select',
  ].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['executeTakeFirst'] = jest.fn().mockResolvedValue(resolveWith);
  chain['executeTakeFirstOrThrow'] = jest.fn().mockResolvedValue(resolveWith);
  chain['execute'] = jest
    .fn()
    .mockResolvedValue(Array.isArray(resolveWith) ? resolveWith : [resolveWith]);
  chain['fn'] = { countAll: jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue(chain) }) };
  return chain;
};

describe('OrderRepository', () => {
  let repo: OrderRepository;
  let mockDb: ReturnType<typeof buildDbChain>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    mockDb = buildDbChain();
    const poolService = { db: mockDb } as unknown as jest.Mocked<PgPoolService>;
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logBatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    repo = new OrderRepository(poolService, auditService);
  });

  describe('findByExchangeOrderId()', () => {
    it('queries by exchange_id and exchange_order_id', async () => {
      const order = { id: 'o1', exchange_order_id: 'EX-123' };
      mockDb['executeTakeFirst'].mockResolvedValueOnce(order);

      const result = await repo.findByExchangeOrderId('BINANCE', 'EX-123');

      expect(result.isOk()).toBe(true);
      expect(mockDb['where']).toHaveBeenCalledWith('exchange_id', '=', 'BINANCE');
      expect(mockDb['where']).toHaveBeenCalledWith('exchange_order_id', '=', 'EX-123');
    });

    it('returns undefined when order not found (no error)', async () => {
      mockDb['executeTakeFirst'].mockResolvedValueOnce(undefined);

      const result = await repo.findByExchangeOrderId('BINANCE', 'MISSING');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBeUndefined();
    });
  });

  describe('findOpenByAccount()', () => {
    it('filters by active statuses', async () => {
      mockDb['execute'].mockResolvedValueOnce([]);

      await repo.findOpenByAccount('account-1');

      expect(mockDb['where']).toHaveBeenCalledWith('status', 'in', [
        'NEW',
        'PARTIALLY_FILLED',
        'PENDING_CANCEL',
      ]);
    });
  });

  describe('findByAccount()', () => {
    it('returns paginated orders for account', async () => {
      const orders = [{ id: 'o1' }, { id: 'o2' }];
      mockDb['execute'].mockResolvedValueOnce(orders);

      const result = await repo.findByAccount('account-1', { page: 1, pageSize: 10 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toEqual(orders);
    });
  });

  describe('save()', () => {
    it('inserts order and logs audit', async () => {
      const order = { id: 'o1', account_id: 'acc-1', symbol: 'BTC/USDT' };
      mockDb['executeTakeFirstOrThrow'].mockResolvedValueOnce(order);

      const result = await repo.save({
        account_id: 'acc-1',
        exchange_id: 'BINANCE',
        exchange_order_id: 'EX-1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        type: 'LIMIT',
        status: 'NEW',
        time_in_force: 'GTC',
        original_quantity: '0.1',
        executed_quantity: '0',
        remaining_quantity: '0.1',
        cumulative_quote_quantity: '0',
        price: '50000',
        average_price: '0',
        reduce_only: false,
        post_only: false,
        is_iceberg: false,
      } as never);

      expect(result.isOk()).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ tableName: 'orders', operation: 'INSERT' }),
      );
    });
  });
});
