import { DomainEvent } from '@domain/base/domain-event';
import { Signal } from '../../interfaces/signal.interface';

export class StrategySignalEvent extends DomainEvent {
  readonly eventType = 'StrategySignal';
  readonly aggregateId: string;
  readonly aggregateVersion = 1;

  constructor(
    readonly signal: Signal,
    occurredAt?: Date,
  ) {
    super(occurredAt);
    this.aggregateId = signal.strategyId;
  }
}
