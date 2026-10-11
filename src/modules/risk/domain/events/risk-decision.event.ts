import { DomainEvent } from '@domain/base/domain-event';
import { RiskDecisionModel } from '../models/risk-decision.model';

export class RiskDecisionEvent extends DomainEvent {
  readonly eventType = 'RiskDecision';
  readonly aggregateId: string;
  readonly aggregateVersion = 1;

  constructor(
    readonly riskDecision: RiskDecisionModel,
    occurredAt?: Date,
  ) {
    super(occurredAt);
    this.aggregateId = riskDecision.signal.strategyId;
  }
}
