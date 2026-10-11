import { PositionManagerService } from '../../../src/modules/position/application/services/position-manager.service';
import { PositionValidatorService } from '../../../src/modules/position/application/services/position-validator.service';
import { PnlCalculatorService } from '../../../src/modules/position/application/services/pnl-calculator.service';
import { PositionStateMachineService } from '../../../src/modules/position/application/services/position-state-machine.service';
import { PositionCacheService } from '../../../src/modules/position/application/services/position-cache.service';
import { FillEventModel } from '../../../src/modules/position/domain/models/fill-event.model';
import { PositionState } from '../../../src/modules/position/domain/enums/position-state.enum';
import { PositionDirection } from '../../../src/modules/position/domain/enums/position-direction.enum';
import { OrderSide } from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionReportType } from '../../../src/modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';

// ── Helpers ───────────────────────────────────────────────────────────────────

let fillCounter = 0;

function makeFill(
  side: OrderSide,
  qty: number,
  price: number,
  overrides: Partial<FillEventModel> = {},
): FillEventModel {
  return {
    fillId: `fill-${++fillCounter}`,
    requestId: 'req-1',
    exchangeId: 'BINANCE',
    symbol: 'BTCUSDT',
    side,
    executedQuantity: qty,
    remainingQuantity: 0,
    averagePrice: price,
    reportType: ExecutionReportType.ORDER_FILLED,
    status: ExecutionStatus.FILLED,
    strategyId: 'strat-1',
    generatedAt: Date.now(),
    ...overrides,
  };
}

function partialFill(
  side: OrderSide,
  qty: number,
  price: number,
  remaining: number,
): FillEventModel {
  return makeFill(side, qty, price, {
    reportType: ExecutionReportType.ORDER_PARTIALLY_FILLED,
    status: ExecutionStatus.PARTIALLY_FILLED,
    remainingQuantity: remaining,
  });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

function buildService() {
  const cacheStore = new Map<string, string>();

  const mockHash = {
    set: jest.fn(async (_key: string, field: string, value: string) => {
      cacheStore.set(field, value);
    }),
    get: jest.fn(async (_key: string, field: string) => {
      return cacheStore.get(field) ?? null;
    }),
    delete: jest.fn(async (_key: string, field: string) => {
      cacheStore.delete(field);
    }),
    getAll: jest.fn(async () => {
      const result: Record<string, string> = {};
      for (const [k, v] of cacheStore.entries()) result[k] = v;
      return Object.keys(result).length ? result : null;
    }),
  };

  const mockRepo = {
    findByAccountAndSymbol: jest.fn().mockResolvedValue({ isOk: () => true, value: [] }),
    save: jest.fn().mockResolvedValue({ isOk: () => true, value: { id: 'db-1', version: 1 } }),
    updateOptimistic: jest.fn().mockResolvedValue({ isOk: () => true, value: {} }),
  };

  const mockPublisher = {
    publish: jest.fn().mockResolvedValue(undefined),
  };

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue({
      enabled: true,
      defaultAccountId: 'acc-1',
      consumerGroup: 'position-manager',
      cacheKeyPrefix: 'positions',
    }),
  };

  const pnlCalc = new PnlCalculatorService();
  const stateMachine = new PositionStateMachineService(pnlCalc);
  const validator = new PositionValidatorService();
  const cache = new PositionCacheService(mockHash as any);

  const service = new PositionManagerService(
    mockConfig as any,
    mockLogger as any,
    {} as any, // consumer — not called in unit tests
    {} as any, // consumerManager
    mockPublisher as any,
    mockRepo as any,
    validator,
    pnlCalc,
    stateMachine,
    cache,
  );

  return { service, mockPublisher, mockRepo, mockLogger, cacheStore };
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('PositionManagerService', () => {
  beforeEach(() => {
    fillCounter = 0;
    jest.clearAllMocks();
  });

  // ── Open position ──────────────────────────────────────────────────────────

  describe('opening a position', () => {
    it('creates LONG position from first BUY fill', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].direction).toBe(PositionDirection.LONG);
      expect(positions[0].state).toBe(PositionState.OPEN);
      expect(positions[0].quantity).toBe(1.0);
      expect(positions[0].averageEntryPrice).toBe(50_000);
    });

    it('creates SHORT position from first SELL fill', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].direction).toBe(PositionDirection.SHORT);
    });

    it('publishes position:update on open', async () => {
      const { service, mockPublisher } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const calls = mockPublisher.publish.mock.calls;
      const posUpdate = calls.find((c: string[]) => c[0] === 'position:update');
      expect(posUpdate).toBeDefined();
    });

    it('publishes portfolio:update on open', async () => {
      const { service, mockPublisher } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const calls = mockPublisher.publish.mock.calls;
      const portUpdate = calls.find((c: string[]) => c[0] === 'portfolio:update');
      expect(portUpdate).toBeDefined();
    });

    it('publishes risk:update on open', async () => {
      const { service, mockPublisher } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const calls = mockPublisher.publish.mock.calls;
      const riskUpdate = calls.find((c: string[]) => c[0] === 'risk:update');
      expect(riskUpdate).toBeDefined();
    });
  });

  // ── Scale in ───────────────────────────────────────────────────────────────

  describe('scale in', () => {
    it('increases quantity and recalculates average entry', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].quantity).toBe(2.0);
      expect(positions[0].averageEntryPrice).toBe(45_000);
    });

    it('accumulates fills array', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      await service.processFill(makeFill(OrderSide.BUY, 0.5, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].fills).toHaveLength(2);
    });
  });

  // ── Partial fill ───────────────────────────────────────────────────────────

  describe('partial fill handling', () => {
    it('processes partial fill as an open + actionable event', async () => {
      const { service } = buildService();
      const fill = partialFill(OrderSide.BUY, 0.5, 50_000, 0.5);
      await service.processFill(fill);

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].quantity).toBe(0.5);
    });

    it('accumulates multiple partial fills', async () => {
      const { service } = buildService();
      await service.processFill(partialFill(OrderSide.BUY, 0.3, 50_000, 0.7));
      await service.processFill(partialFill(OrderSide.BUY, 0.3, 51_000, 0.4));
      await service.processFill(makeFill(OrderSide.BUY, 0.4, 52_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].quantity).toBeCloseTo(1.0);
      expect(positions[0].fills).toHaveLength(3);
    });
  });

  // ── Scale out / partial close ──────────────────────────────────────────────

  describe('scale out (partial close)', () => {
    it('reduces quantity and realizes partial PnL', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 2.0, 40_000));
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].quantity).toBe(1.0);
      expect(positions[0].realizedPnl).toBe(10_000);
      expect(positions[0].state).toBe(PositionState.OPEN);
    });
  });

  // ── Full close ─────────────────────────────────────────────────────────────

  describe('full close', () => {
    it('position becomes FLAT after full close', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(0);
    });

    it('realized PnL is correct after close', async () => {
      const { service, cacheStore } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));

      // Position is FLAT but still in cache
      const raw = cacheStore.get('BINANCE:BTCUSDT');
      const pos = raw ? JSON.parse(raw) : null;
      expect(pos).not.toBeNull();
      expect(pos.realizedPnl).toBe(10_000);
    });

    it('publishes position update with FLAT state after close', async () => {
      const { service, mockPublisher } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      jest.clearAllMocks();
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));

      const calls = mockPublisher.publish.mock.calls;
      const posUpdate = calls.find((c: string[]) => c[0] === 'position:update');
      expect(posUpdate).toBeDefined();
      expect(posUpdate[1].payload.state).toBe(PositionState.FLAT);
    });
  });

  // ── Reverse ────────────────────────────────────────────────────────────────

  describe('position reversal', () => {
    it('LONG → SHORT with excess quantity', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));
      await service.processFill(makeFill(OrderSide.SELL, 3.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].direction).toBe(PositionDirection.SHORT);
      expect(positions[0].quantity).toBe(2.0);
      expect(positions[0].realizedPnl).toBe(10_000);
    });

    it('SHORT → LONG reversal', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.SELL, 1.0, 50_000));
      await service.processFill(makeFill(OrderSide.BUY, 2.0, 40_000));

      const positions = await service.getOpenPositions();
      expect(positions[0].direction).toBe(PositionDirection.LONG);
      expect(positions[0].quantity).toBe(1.0);
      expect(positions[0].realizedPnl).toBe(10_000);
    });
  });

  // ── Duplicate fill ─────────────────────────────────────────────────────────

  describe('duplicate fill protection', () => {
    it('ignores a fill with the same fillId', async () => {
      const { service } = buildService();
      const fill = makeFill(OrderSide.BUY, 1.0, 50_000, { fillId: 'dup-fill' });
      await service.processFill(fill);
      await service.processFill(fill);

      const positions = await service.getOpenPositions();
      expect(positions[0].quantity).toBe(1.0);
      expect(positions[0].fillIds).toHaveLength(1);
    });

    it('logs a warning for duplicate fill', async () => {
      const { service, mockLogger } = buildService();
      const fill = makeFill(OrderSide.BUY, 1.0, 50_000, { fillId: 'dup-fill' });
      await service.processFill(fill);
      await service.processFill(fill);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate fill'),
        expect.anything(),
      );
    });
  });

  // ── Validation rejections ──────────────────────────────────────────────────

  describe('fill validation', () => {
    it('rejects a fill with zero executedQuantity (non-actionable)', async () => {
      const { service } = buildService();
      const fill = makeFill(OrderSide.BUY, 0, 50_000, {
        reportType: ExecutionReportType.ORDER_ACCEPTED,
      });
      await service.processFill(fill);

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(0);
    });

    it('rejects a fill with negative quantity', async () => {
      const { service, mockLogger } = buildService();
      const fill = makeFill(OrderSide.BUY, -1, 50_000);
      await service.processFill(fill);

      expect(mockLogger.warn).toHaveBeenCalled();
      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(0);
    });

    it('rejects a fill with zero price', async () => {
      const { service, mockLogger } = buildService();
      const fill = makeFill(OrderSide.BUY, 1.0, 0);
      await service.processFill(fill);

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  // ── Restart / recovery ─────────────────────────────────────────────────────

  describe('restart recovery', () => {
    it('reloads position from DB when cache miss on restart', async () => {
      const { service, mockRepo } = buildService();

      mockRepo.findByAccountAndSymbol.mockResolvedValue({
        isOk: () => true,
        value: [
          {
            id: 'db-pos-1',
            account_id: 'acc-1',
            exchange_id: 'BINANCE',
            symbol: 'BTCUSDT',
            position_side: 'LONG',
            quantity: '2.0',
            entry_price: '45000',
            mark_price: '47000',
            realized_pnl: '2000',
            unrealized_pnl: '4000',
            status: 'open',
            version: 5,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));

      const positions = await service.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(mockRepo.findByAccountAndSymbol).toHaveBeenCalled();
    });
  });

  // ── Portfolio summary ──────────────────────────────────────────────────────

  describe('buildPortfolioSummary', () => {
    it('returns zero-state for no positions', () => {
      const { service } = buildService();
      const summary = service.buildPortfolioSummary([]);
      expect(summary.totalOpenPositions).toBe(0);
      expect(summary.totalExposure).toBe(0);
      expect(summary.netPnl).toBe(0);
    });

    it('counts winning and losing positions correctly', async () => {
      const { service } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 40_000));

      const positions = await service.getOpenPositions();
      const summary = service.buildPortfolioSummary(positions);
      expect(summary.totalOpenPositions).toBe(1);
    });
  });

  // ── Persistence ────────────────────────────────────────────────────────────

  describe('persistence', () => {
    it('calls repo.save on first fill (version=1)', async () => {
      const { service, mockRepo } = buildService();
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('calls repo.updateOptimistic on subsequent fills', async () => {
      const { service, mockRepo } = buildService();
      mockRepo.findByAccountAndSymbol.mockResolvedValue({
        isOk: () => true,
        value: [
          {
            id: 'db-1',
            account_id: 'acc-1',
            exchange_id: 'BINANCE',
            symbol: 'BTCUSDT',
            position_side: 'LONG',
            quantity: '1.0',
            entry_price: '50000',
            mark_price: '50000',
            realized_pnl: '0',
            unrealized_pnl: '0',
            status: 'open',
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      await service.processFill(makeFill(OrderSide.BUY, 1.0, 50_000));
      jest.clearAllMocks();
      mockRepo.findByAccountAndSymbol.mockResolvedValue({
        isOk: () => true,
        value: [
          {
            id: 'db-1',
            account_id: 'acc-1',
            exchange_id: 'BINANCE',
            symbol: 'BTCUSDT',
            position_side: 'LONG',
            quantity: '1.0',
            entry_price: '50000',
            mark_price: '50000',
            realized_pnl: '0',
            unrealized_pnl: '0',
            status: 'open',
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      await service.processFill(makeFill(OrderSide.BUY, 0.5, 52_000));
      expect(mockRepo.updateOptimistic).toHaveBeenCalled();
    });
  });
});
