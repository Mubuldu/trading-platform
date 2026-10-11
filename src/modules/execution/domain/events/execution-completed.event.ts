import { DomainEvent } from '@domain/base/domain-event';
import { ExecutionReportModel } from '../models/execution-report.model';

export class ExecutionCompletedEvent extends DomainEvent {
  readonly eventType = 'ExecutionCompleted';
  readonly aggregateId: string;
  readonly aggregateVersion = 1;

  constructor(
    readonly report: ExecutionReportModel,
    occurredAt?: Date,
  ) {
    super(occurredAt);
    this.aggregateId = report.requestId;
  }
}
