import { PnlCalculatorService } from '../../../src/modules/position/application/services/pnl-calculator.service';
import { PositionDirection } from '../../../src/modules/position/domain/enums/position-direction.enum';

describe('PnlCalculatorService', () => {
  let service: PnlCalculatorService;

  beforeEach(() => {
    service = new PnlCalculatorService();
  });

  // ── recalculateAverageEntry ────────────────────────────────────────────────

  describe('recalculateAverageEntry', () => {
    it('returns fill price when existing qty is zero (opening)', () => {
      const result = service.recalculateAverageEntry(0, 0, 1.0, 50_000);
      expect(result.newAverageEntryPrice).toBe(50_000);
      expect(result.newQuantity).toBe(1.0);
    });

    it('computes weighted average for scale-in', () => {
      // 1 BTC @ 40k + 1 BTC @ 50k → avg = 45k
      const result = service.recalculateAverageEntry(1.0, 40_000, 1.0, 50_000);
      expect(result.newAverageEntryPrice).toBe(45_000);
      expect(result.newQuantity).toBe(2.0);
    });

    it('handles unequal quantities', () => {
      // 2 BTC @ 40k + 1 BTC @ 52k → (80k + 52k) / 3 = 44k
      const result = service.recalculateAverageEntry(2.0, 40_000, 1.0, 52_000);
      expect(result.newAverageEntryPrice).toBeCloseTo(44_000);
      expect(result.newQuantity).toBe(3.0);
    });

    it('returns zero when both quantities are zero', () => {
      const result = service.recalculateAverageEntry(0, 0, 0, 0);
      expect(result.newAverageEntryPrice).toBe(0);
      expect(result.newQuantity).toBe(0);
    });
  });

  // ── calculateRealizedPnlFromClose ─────────────────────────────────────────

  describe('calculateRealizedPnlFromClose', () => {
    it('LONG: profit when close price > entry', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.LONG,
        1.0,
        40_000,
        50_000,
      );
      expect(pnl).toBe(10_000);
    });

    it('LONG: loss when close price < entry', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.LONG,
        1.0,
        50_000,
        40_000,
      );
      expect(pnl).toBe(-10_000);
    });

    it('SHORT: profit when close price < entry', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.SHORT,
        1.0,
        50_000,
        40_000,
      );
      expect(pnl).toBe(10_000);
    });

    it('SHORT: loss when close price > entry', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.SHORT,
        1.0,
        40_000,
        50_000,
      );
      expect(pnl).toBe(-10_000);
    });

    it('scales proportionally with quantity', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.LONG,
        2.0,
        40_000,
        50_000,
      );
      expect(pnl).toBe(20_000);
    });

    it('FLAT direction returns zero', () => {
      const pnl = service.calculateRealizedPnlFromClose(
        PositionDirection.FLAT,
        1.0,
        40_000,
        50_000,
      );
      expect(pnl).toBe(0);
    });
  });

  // ── calculateUnrealizedPnl ────────────────────────────────────────────────

  describe('calculateUnrealizedPnl', () => {
    it('LONG: positive when mark > entry', () => {
      const pnl = service.calculateUnrealizedPnl(PositionDirection.LONG, 1.0, 40_000, 50_000);
      expect(pnl).toBe(10_000);
    });

    it('LONG: negative when mark < entry', () => {
      const pnl = service.calculateUnrealizedPnl(PositionDirection.LONG, 1.0, 50_000, 40_000);
      expect(pnl).toBe(-10_000);
    });

    it('SHORT: positive when mark < entry', () => {
      const pnl = service.calculateUnrealizedPnl(PositionDirection.SHORT, 1.0, 50_000, 40_000);
      expect(pnl).toBe(10_000);
    });

    it('SHORT: negative when mark > entry', () => {
      const pnl = service.calculateUnrealizedPnl(PositionDirection.SHORT, 1.0, 40_000, 50_000);
      expect(pnl).toBe(-10_000);
    });

    it('zero when mark equals entry', () => {
      const pnl = service.calculateUnrealizedPnl(PositionDirection.LONG, 1.0, 50_000, 50_000);
      expect(pnl).toBe(0);
    });
  });

  // ── buildSnapshot ─────────────────────────────────────────────────────────

  describe('buildSnapshot', () => {
    it('computes all fields correctly', () => {
      const snap = service.buildSnapshot(500, 300, 100);
      expect(snap.realizedPnl).toBe(500);
      expect(snap.unrealizedPnl).toBe(300);
      expect(snap.grossPnl).toBe(800);
      expect(snap.netPnl).toBe(800);
      expect(snap.feeAdjustedPnl).toBe(700);
    });

    it('fee-adjusted is negative when fees exceed profit', () => {
      const snap = service.buildSnapshot(0, 50, 100);
      expect(snap.feeAdjustedPnl).toBe(-50);
    });
  });
});
