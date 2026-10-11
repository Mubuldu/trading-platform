import { PositionValidatorService } from '../../../src/modules/position/application/services/position-validator.service';
import { FillEventModel } from '../../../src/modules/position/domain/models/fill-event.model';
import {
  PositionModel,
  createFlatPosition,
} from '../../../src/modules/position/domain/models/position.model';
import { OrderSide } from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionReportType } from '../../../src/modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';

function makeFill(overrides: Partial<FillEventModel> = {}): FillEventModel {
  return {
    fillId: 'fill-1',
    requestId: 'req-1',
    exchangeId: 'BINANCE',
    symbol: 'BTCUSDT',
    side: OrderSide.BUY,
    executedQuantity: 1.0,
    remainingQuantity: 0,
    averagePrice: 50_000,
    reportType: ExecutionReportType.ORDER_FILLED,
    status: ExecutionStatus.FILLED,
    strategyId: 'strat-1',
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makePosition(): PositionModel {
  return createFlatPosition('BINANCE', 'acc-1', 'BTCUSDT', 'strat-1');
}

describe('PositionValidatorService', () => {
  let service: PositionValidatorService;

  beforeEach(() => {
    service = new PositionValidatorService();
  });

  describe('validate', () => {
    it('accepts a valid fill on a flat position', () => {
      const result = service.validate(makeFill(), makePosition());
      expect(result.isOk()).toBe(true);
    });

    it('rejects negative executedQuantity', () => {
      const result = service.validate(makeFill({ executedQuantity: -1 }), makePosition());
      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.message).toMatch(/Negative quantity/);
    });

    it('rejects zero averagePrice', () => {
      const result = service.validate(makeFill({ averagePrice: 0 }), makePosition());
      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.message).toMatch(/Invalid average price/);
    });

    it('rejects negative averagePrice', () => {
      const result = service.validate(makeFill({ averagePrice: -1 }), makePosition());
      expect(result.isErr()).toBe(true);
    });

    it('rejects duplicate fill', () => {
      const position = makePosition();
      position.fillIds.push('fill-1');
      const result = service.validate(makeFill({ fillId: 'fill-1' }), position);
      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.message).toMatch(/Duplicate fill/);
    });

    it('accepts fill with id not previously seen', () => {
      const position = makePosition();
      position.fillIds.push('fill-99');
      const result = service.validate(makeFill({ fillId: 'fill-1' }), position);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('isActionable', () => {
    it('returns true for ORDER_FILLED with executedQty > 0', () => {
      expect(
        service.isActionable(
          makeFill({ reportType: ExecutionReportType.ORDER_FILLED, executedQuantity: 1 }),
        ),
      ).toBe(true);
    });

    it('returns true for ORDER_PARTIALLY_FILLED with executedQty > 0', () => {
      expect(
        service.isActionable(
          makeFill({
            reportType: ExecutionReportType.ORDER_PARTIALLY_FILLED,
            executedQuantity: 0.5,
          }),
        ),
      ).toBe(true);
    });

    it('returns false for ORDER_ACCEPTED (no execution yet)', () => {
      expect(
        service.isActionable(
          makeFill({ reportType: ExecutionReportType.ORDER_ACCEPTED, executedQuantity: 0 }),
        ),
      ).toBe(false);
    });

    it('returns false for ORDER_REJECTED', () => {
      expect(
        service.isActionable(
          makeFill({ reportType: ExecutionReportType.ORDER_REJECTED, executedQuantity: 0 }),
        ),
      ).toBe(false);
    });

    it('returns false when executedQuantity is zero even if report type is FILLED', () => {
      expect(
        service.isActionable(
          makeFill({ reportType: ExecutionReportType.ORDER_FILLED, executedQuantity: 0 }),
        ),
      ).toBe(false);
    });
  });
});
