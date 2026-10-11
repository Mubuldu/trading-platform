import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { ExecutionReportModel } from '@modules/execution/domain/models/execution-report.model';
import { OrderModel } from '../../domain/models/order.model';
import { DuplicateReportError, OrderError } from '../../domain/errors/order.errors';
import { OrderCacheService } from './order-cache.service';

@Injectable()
export class OrderValidatorService {
  constructor(private readonly cache: OrderCacheService) {}

  async checkDuplicateReport(report: ExecutionReportModel): Promise<Result<void, OrderError>> {
    const seen = await this.cache.isReportSeen(report.reportId);
    if (seen) {
      return err(new DuplicateReportError(report.reportId));
    }
    return ok(undefined);
  }

  isAlreadySeen(order: OrderModel, reportId: string): boolean {
    return order.reportIds.includes(reportId);
  }
}
