import { ExecutionValidatorService } from '../../../src/modules/execution/application/services/execution-validator.service';
import { RiskDecisionModel } from '../../../src/modules/risk/domain/models/risk-decision.model';
import { RiskDecision } from '../../../src/modules/risk/domain/enums/risk-decision.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';

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
    reason: 'all good',
    evaluatedAt: Date.now(),
    durationMs: 10,
    ...overrides,
  };
}

describe('ExecutionValidatorService', () => {
  let service: ExecutionValidatorService;

  beforeEach(() => {
    service = new ExecutionValidatorService();
  });

  it('returns ok for a valid APPROVE decision', () => {
    const result = service.validate(makeDecision());
    expect(result.isOk()).toBe(true);
  });

  it('returns ok for a REDUCE decision', () => {
    const result = service.validate(makeDecision({ decision: RiskDecision.REDUCE }));
    expect(result.isOk()).toBe(true);
  });

  it('rejects REJECT decisions', () => {
    const result = service.validate(makeDecision({ decision: RiskDecision.REJECT }));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('REJECT');
  });

  it('rejects BLOCK decisions', () => {
    const result = service.validate(makeDecision({ decision: RiskDecision.BLOCK }));
    expect(result.isErr()).toBe(true);
  });

  it('rejects HOLD signals', () => {
    const result = service.validate(
      makeDecision({
        signal: { ...makeDecision().signal, direction: SignalDirection.HOLD },
      }),
    );
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('HOLD');
  });

  it('rejects empty symbol', () => {
    const result = service.validate(
      makeDecision({
        signal: { ...makeDecision().signal, symbol: '' },
      }),
    );
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('symbol');
  });

  it('rejects empty exchange', () => {
    const result = service.validate(
      makeDecision({
        signal: { ...makeDecision().signal, exchange: '' },
      }),
    );
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('exchange');
  });

  it('rejects zero recommendedSizeUsd', () => {
    const result = service.validate(makeDecision({ recommendedSizeUsd: 0 }));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('size');
  });

  it('rejects null recommendedSizeUsd', () => {
    const result = service.validate(makeDecision({ recommendedSizeUsd: null }));
    expect(result.isErr()).toBe(true);
  });

  it('rejects negative recommendedSizeUsd', () => {
    const result = service.validate(makeDecision({ recommendedSizeUsd: -100 }));
    expect(result.isErr()).toBe(true);
  });
});
