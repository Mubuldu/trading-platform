import { DomainEvent } from '@domain/base/domain-event';

export class IndicatorReadyEvent extends DomainEvent {
  readonly eventType = 'IndicatorReady';
  readonly aggregateId: string;
  readonly aggregateVersion = 1;

  constructor(
    readonly indicatorId: string,
    readonly symbol: string,
    readonly timeframe: string,
    readonly indicatorType: string,
    occurredAt?: Date,
  ) {
    super(occurredAt);
    this.aggregateId = indicatorId;
  }
}

export class AllIndicatorsReadyEvent extends DomainEvent {
  readonly eventType = 'AllIndicatorsReady';
  readonly aggregateId = 'indicator-engine';
  readonly aggregateVersion = 1;

  constructor(
    readonly totalIndicators: number,
    occurredAt?: Date,
  ) {
    super(occurredAt);
  }
}
