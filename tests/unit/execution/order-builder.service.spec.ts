import { OrderBuilderService } from '../../../src/modules/execution/application/services/order-builder.service';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import { OrderSide, OrderType, TimeInForce } from '../../../src/modules/exchange/enums/order.enums';
import { RiskDecision } from '../../../src/modules/risk/domain/enums/risk-decision.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { RiskDecisionModel } from '../../../src/modules/risk/domain/models/risk-decision.model';

function makeDecision(overrides: Partial<RiskDecisionModel> = {}): RiskDecisionModel {
  return {
    decisionId: 'd-1',
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'paper_trading',
      symbol: 'BTC/USDT',
      direction: SignalDirection.BUY,
      confidence: 0.8,
      reason: 'test',
      metadata: {},
    },
    decision: RiskDecision.APPROVE,
    violations: [],
    recommendedSize: null,
    recommendedSizeUsd: 1000,
    sizingMethod: null,
    sizeReductionFactor: 1.0,
    reason: 'ok',
    evaluatedAt: Date.now(),
    durationMs: 5,
    ...overrides,
  };
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getTicker: jest.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: { lastPrice: 50_000 },
    }),
    getSymbolInfo: jest.fn().mockResolvedValue({
      isOk: () => false,
      isErr: () => true,
    }),
    ...overrides,
  };
}

describe('OrderBuilderService', () => {
  let service: OrderBuilderService;

  beforeEach(() => {
    service = new OrderBuilderService();
  });

  describe('side mapping', () => {
    it('maps BUY direction to OrderSide.BUY', async () => {
      const adapter = makeAdapter();
      const result = await service.build(makeDecision(), ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.side).toBe(OrderSide.BUY);
      }
    });

    it('maps SELL direction to OrderSide.SELL', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, direction: SignalDirection.SELL },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.side).toBe(OrderSide.SELL);
      }
    });

    it('maps EXIT direction to OrderSide.SELL', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, direction: SignalDirection.EXIT },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.side).toBe(OrderSide.SELL);
      }
    });
  });

  describe('order type detection', () => {
    it('defaults to MARKET when no price in metadata', async () => {
      const adapter = makeAdapter();
      const result = await service.build(makeDecision(), ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.orderType).toBe(OrderType.MARKET);
      }
    });

    it('uses LIMIT when price is in metadata', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, metadata: { price: 48_000 } },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.orderType).toBe(OrderType.LIMIT);
        expect(result.value.price).toBe(48_000);
      }
    });

    it('uses explicit orderType from metadata', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: {
          ...makeDecision().signal,
          metadata: { orderType: 'STOP_LIMIT', price: 48_000, stopPrice: 49_000 },
        },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.orderType).toBe(OrderType.STOP_LIMIT);
        expect(result.value.stopPrice).toBe(49_000);
      }
    });
  });

  describe('quantity computation', () => {
    it('computes quantity from recommendedSizeUsd / ticker lastPrice', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({ recommendedSizeUsd: 1000 });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 1000 / 50000 = 0.02
        expect(result.value.quantity).toBeCloseTo(0.02, 6);
      }
    });

    it('uses price from metadata for quantity calculation when price is in metadata', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        recommendedSizeUsd: 1000,
        signal: { ...makeDecision().signal, metadata: { price: 25_000 } },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 1000 / 25000 = 0.04
        expect(result.value.quantity).toBeCloseTo(0.04, 6);
      }
    });

    it('returns err when ticker fails and no price in metadata', async () => {
      const adapter = makeAdapter({
        getTicker: jest.fn().mockResolvedValue({
          isOk: () => false,
          isErr: () => true,
          error: { message: 'ticker unavailable' },
        }),
      });
      const result = await service.build(makeDecision(), ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ticker');
      }
    });
  });

  describe('symbol info precision', () => {
    it('rounds quantity down to quantityPrecision when symbolInfo is available', async () => {
      const adapter = makeAdapter({
        getSymbolInfo: jest.fn().mockResolvedValue({
          isOk: () => true,
          isErr: () => false,
          value: { quantityPrecision: 3, minQuantity: 0.001 },
        }),
      });
      const decision = makeDecision({ recommendedSizeUsd: 1000 });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 1000/50000 = 0.02 → precision 3 → 0.020
        expect(result.value.quantity).toBe(0.02);
      }
    });

    it('returns err when computed quantity is below minQuantity', async () => {
      const adapter = makeAdapter({
        getSymbolInfo: jest.fn().mockResolvedValue({
          isOk: () => true,
          isErr: () => false,
          value: { quantityPrecision: 2, minQuantity: 1.0 },
        }),
      });
      const decision = makeDecision({ recommendedSizeUsd: 100 });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('minQuantity');
      }
    });
  });

  describe('clientOrderId', () => {
    it('generates a clientOrderId containing strategyId and decisionId', async () => {
      const adapter = makeAdapter();
      const result = await service.build(makeDecision(), ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.clientOrderId).toContain('strat-1');
        expect(result.value.clientOrderId).toContain('d-1');
      }
    });
  });

  describe('time in force', () => {
    it('sets GTC for LIMIT orders without explicit TIF', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, metadata: { price: 48_000 } },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.timeInForce).toBe(TimeInForce.GTC);
      }
    });

    it('sets IOC when ioc flag is in metadata', async () => {
      const adapter = makeAdapter();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, metadata: { price: 48_000, ioc: true } },
      });
      const result = await service.build(decision, ExchangeId.PAPER_TRADING, adapter as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.timeInForce).toBe(TimeInForce.IOC);
      }
    });
  });
});
