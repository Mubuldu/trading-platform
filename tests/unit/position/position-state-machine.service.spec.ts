import { PositionStateMachineService } from '../../../src/modules/position/application/services/position-state-machine.service';
import { PnlCalculatorService } from '../../../src/modules/position/application/services/pnl-calculator.service';
import { FillEventModel } from '../../../src/modules/position/domain/models/fill-event.model';
import {
  PositionModel,
  createFlatPosition,
} from '../../../src/modules/position/domain/models/position.model';
import { PositionState } from '../../../src/modules/position/domain/enums/position-state.enum';
import { PositionDirection } from '../../../src/modules/position/domain/enums/position-direction.enum';
import { PositionAction } from '../../../src/modules/position/domain/enums/position-action.enum';
import { OrderSide } from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionReportType } from '../../../src/modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';

function makeFill(
  side: OrderSide,
  qty: number,
  price: number,
  overrides: Partial<FillEventModel> = {},
): FillEventModel {
  return {
    fillId: `fill-${Math.random()}`,
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

function flatPosition(): PositionModel {
  return createFlatPosition('BINANCE', 'acc-1', 'BTCUSDT', 'strat-1');
}

describe('PositionStateMachineService', () => {
  let service: PositionStateMachineService;

  beforeEach(() => {
    service = new PositionStateMachineService(new PnlCalculatorService());
  });

  // ── OPEN ──────────────────────────────────────────────────────────────────

  describe('opening a LONG position (FLAT + BUY)', () => {
    it('transitions FLAT → OPEN with correct fields', () => {
      const pos = flatPosition();
      const fill = makeFill(OrderSide.BUY, 1.0, 50_000);

      const result = service.apply(pos, fill);

      expect(result.isOk()).toBe(true);
      expect(pos.state).toBe(PositionState.OPEN);
      expect(pos.direction).toBe(PositionDirection.LONG);
      expect(pos.quantity).toBe(1.0);
      expect(pos.entryPrice).toBe(50_000);
      expect(pos.averageEntryPrice).toBe(50_000);
      expect(result.isOk() && result.value.action).toBe(PositionAction.OPEN);
      expect(result.isOk() && result.value.realizedPnlDelta).toBe(0);
    });

    it('records fill in fillIds and fills array', () => {
      const pos = flatPosition();
      const fill = makeFill(OrderSide.BUY, 1.0, 50_000, { fillId: 'my-fill' });
      service.apply(pos, fill);
      expect(pos.fillIds).toContain('my-fill');
      expect(pos.fills).toHaveLength(1);
      expect(pos.fills[0].fillId).toBe('my-fill');
    });
  });

  describe('opening a SHORT position (FLAT + SELL)', () => {
    it('transitions FLAT → OPEN with SHORT direction', () => {
      const pos = flatPosition();
      const fill = makeFill(OrderSide.SELL, 1.0, 50_000);

      service.apply(pos, fill);

      expect(pos.direction).toBe(PositionDirection.SHORT);
      expect(pos.state).toBe(PositionState.OPEN);
    });
  });

  // ── SCALE IN ──────────────────────────────────────────────────────────────

  describe('scale in (OPEN LONG + BUY)', () => {
    it('increases quantity and recalculates average entry', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 50_000));

      expect(pos.state).toBe(PositionState.OPEN);
      expect(pos.quantity).toBe(2.0);
      expect(pos.averageEntryPrice).toBe(45_000);
      expect(pos.fills).toHaveLength(2);
    });

    it('action is INCREASE', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      const result = service.apply(pos, makeFill(OrderSide.BUY, 1.0, 50_000));
      expect(result.isOk() && result.value.action).toBe(PositionAction.INCREASE);
    });

    it('no realized PnL on scale in', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      const result = service.apply(pos, makeFill(OrderSide.BUY, 1.0, 50_000));
      expect(result.isOk() && result.value.realizedPnlDelta).toBe(0);
    });
  });

  // ── PARTIAL CLOSE ─────────────────────────────────────────────────────────

  describe('partial close (OPEN LONG + SELL with qty < position)', () => {
    it('reduces quantity and realizes partial PnL', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 2.0, 40_000));
      const result = service.apply(pos, makeFill(OrderSide.SELL, 1.0, 50_000));

      expect(pos.state).toBe(PositionState.OPEN);
      expect(pos.quantity).toBe(1.0);
      expect(pos.realizedPnl).toBe(10_000);
      expect(result.isOk() && result.value.action).toBe(PositionAction.PARTIAL_CLOSE);
      expect(result.isOk() && result.value.closedQuantity).toBe(1.0);
    });

    it('average entry price unchanged after partial close', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 2.0, 40_000));
      service.apply(pos, makeFill(OrderSide.SELL, 1.0, 50_000));
      expect(pos.averageEntryPrice).toBe(40_000);
    });
  });

  // ── FULL CLOSE ────────────────────────────────────────────────────────────

  describe('full close (OPEN LONG + SELL with qty == position)', () => {
    it('transitions to FLAT and realizes full PnL', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      const result = service.apply(pos, makeFill(OrderSide.SELL, 1.0, 50_000));

      expect(pos.state).toBe(PositionState.FLAT);
      expect(pos.direction).toBe(PositionDirection.FLAT);
      expect(pos.quantity).toBe(0);
      expect(pos.realizedPnl).toBe(10_000);
      expect(pos.closedAt).not.toBeNull();
      expect(result.isOk() && result.value.action).toBe(PositionAction.CLOSE);
    });

    it('SHORT full close realizes profit when price dropped', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.SELL, 1.0, 50_000));
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));

      expect(pos.state).toBe(PositionState.FLAT);
      expect(pos.realizedPnl).toBe(10_000);
    });
  });

  // ── REVERSE ───────────────────────────────────────────────────────────────

  describe('reverse (OPEN LONG + SELL with qty > position)', () => {
    it('closes long and opens short with excess qty', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      const result = service.apply(pos, makeFill(OrderSide.SELL, 3.0, 50_000));

      expect(pos.direction).toBe(PositionDirection.SHORT);
      expect(pos.state).toBe(PositionState.OPEN);
      expect(pos.quantity).toBe(2.0);
      expect(pos.realizedPnl).toBe(10_000);
      expect(pos.averageEntryPrice).toBe(50_000);
      expect(result.isOk() && result.value.action).toBe(PositionAction.REVERSE);
      expect(result.isOk() && result.value.closedQuantity).toBe(1.0);
      expect(result.isOk() && result.value.reverseQuantity).toBe(2.0);
    });

    it('reverse SHORT → LONG', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.SELL, 1.0, 50_000));
      service.apply(pos, makeFill(OrderSide.BUY, 3.0, 40_000));

      expect(pos.direction).toBe(PositionDirection.LONG);
      expect(pos.quantity).toBe(2.0);
      expect(pos.realizedPnl).toBe(10_000);
    });
  });

  // ── VERSION TRACKING ──────────────────────────────────────────────────────

  describe('version increments', () => {
    it('increments version on each transition', () => {
      const pos = flatPosition();
      expect(pos.version).toBe(0);
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 40_000));
      expect(pos.version).toBe(1);
      service.apply(pos, makeFill(OrderSide.BUY, 1.0, 50_000));
      expect(pos.version).toBe(2);
      service.apply(pos, makeFill(OrderSide.SELL, 2.0, 45_000));
      expect(pos.version).toBe(3);
    });
  });

  // ── ACCUMULATED FILLS ─────────────────────────────────────────────────────

  describe('accumulated fills tracking', () => {
    it('records all fills in order', () => {
      const pos = flatPosition();
      service.apply(pos, makeFill(OrderSide.BUY, 0.5, 40_000, { fillId: 'f1' }));
      service.apply(pos, makeFill(OrderSide.BUY, 0.3, 42_000, { fillId: 'f2' }));
      service.apply(pos, makeFill(OrderSide.SELL, 0.2, 45_000, { fillId: 'f3' }));

      expect(pos.fillIds).toEqual(['f1', 'f2', 'f3']);
      expect(pos.fills).toHaveLength(3);
    });
  });
});
