import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { RiskDecisionModel } from '@modules/risk/domain/models/risk-decision.model';
import { RiskDecision } from '@modules/risk/domain/enums/risk-decision.enum';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { ExecutionValidationError } from '../../domain/errors/execution.errors';

@Injectable()
export class ExecutionValidatorService {
  validate(decision: RiskDecisionModel): Result<void, ExecutionValidationError> {
    const { signal, decision: outcome, recommendedSizeUsd } = decision;

    if (outcome !== RiskDecision.APPROVE && outcome !== RiskDecision.REDUCE) {
      return err(
        new ExecutionValidationError(
          `Risk decision is ${outcome} — only APPROVE or REDUCE may be executed`,
        ),
      );
    }

    if (signal.direction === SignalDirection.HOLD) {
      return err(new ExecutionValidationError('HOLD signals do not require order execution'));
    }

    if (!signal.symbol || signal.symbol.trim().length === 0) {
      return err(new ExecutionValidationError('Signal has no valid symbol'));
    }

    if (!signal.exchange || signal.exchange.trim().length === 0) {
      return err(new ExecutionValidationError('Signal has no valid exchange'));
    }

    if (!recommendedSizeUsd || recommendedSizeUsd <= 0) {
      return err(new ExecutionValidationError(`Invalid order size: ${recommendedSizeUsd}`));
    }

    return ok(undefined);
  }
}
