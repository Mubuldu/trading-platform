import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result/result';
import { FillEventModel } from '../../domain/models/fill-event.model';
import { PositionModel } from '../../domain/models/position.model';
import { ExecutionReportType } from '@modules/execution/domain/enums/execution-report-type.enum';
import {
  DuplicateFillError,
  NegativeQuantityError,
  InvalidAveragePriceError,
  PositionError,
} from '../../domain/errors/position.errors';

@Injectable()
export class PositionValidatorService {
  validate(fill: FillEventModel, position: PositionModel): Result<void, PositionError> {
    if (fill.executedQuantity < 0) {
      return err(new NegativeQuantityError(fill.executedQuantity, { fillId: fill.fillId }));
    }

    if (fill.averagePrice <= 0) {
      return err(new InvalidAveragePriceError(fill.averagePrice, { fillId: fill.fillId }));
    }

    if (position.fillIds.includes(fill.fillId)) {
      return err(new DuplicateFillError(fill.fillId));
    }

    return ok(undefined);
  }

  isActionable(fill: FillEventModel): boolean {
    return (
      fill.executedQuantity > 0 &&
      (fill.reportType === ExecutionReportType.ORDER_FILLED ||
        fill.reportType === ExecutionReportType.ORDER_PARTIALLY_FILLED)
    );
  }
}
