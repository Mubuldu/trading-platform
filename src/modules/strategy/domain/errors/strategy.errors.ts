import { HttpStatus } from '@nestjs/common';
import { DomainError } from '@domain/errors/domain.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export class StrategyNotFoundError extends DomainError {
  readonly code = ErrorCode.STRATEGY_NOT_FOUND;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(strategyId: string) {
    super(`Strategy "${strategyId}" not found`, { strategyId });
  }
}

export class StrategyAlreadyRegisteredError extends DomainError {
  readonly code = ErrorCode.STRATEGY_ALREADY_REGISTERED;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(strategyId: string) {
    super(`Strategy "${strategyId}" is already registered`, { strategyId });
  }
}

export class StrategyInitializationError extends DomainError {
  readonly code = ErrorCode.STRATEGY_INITIALIZATION_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(strategyId: string, reason: string) {
    super(`Strategy "${strategyId}" initialization failed: ${reason}`, { strategyId, reason });
  }
}

export class StrategyConfigValidationError extends DomainError {
  readonly code = ErrorCode.STRATEGY_CONFIG_INVALID;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(strategyId: string, reason: string) {
    super(`Strategy "${strategyId}" config invalid: ${reason}`, { strategyId, reason });
  }
}

export class StrategyExecutionError extends DomainError {
  readonly code = ErrorCode.STRATEGY_EXECUTION_ERROR;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(strategyId: string, hook: string, reason: string) {
    super(`Strategy "${strategyId}" failed in ${hook}: ${reason}`, { strategyId, hook, reason });
  }
}

export class StrategyWarmupError extends DomainError {
  readonly code = ErrorCode.STRATEGY_WARMUP_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(strategyId: string, reason: string) {
    super(`Strategy "${strategyId}" warmup failed: ${reason}`, { strategyId, reason });
  }
}

export class StrategyNotEnabledError extends DomainError {
  readonly code = ErrorCode.STRATEGY_NOT_ENABLED;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(strategyId: string) {
    super(`Strategy "${strategyId}" is not enabled`, { strategyId });
  }
}

export class StrategyResourceLimitError extends DomainError {
  readonly code = ErrorCode.STRATEGY_RESOURCE_LIMIT_EXCEEDED;
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;

  constructor(strategyId: string, limitName: string, actual: number, max: number) {
    super(`Strategy "${strategyId}" exceeded ${limitName}: ${actual} > ${max}`, {
      strategyId,
      limitName,
      actual,
      max,
    });
  }
}

export type StrategyError =
  | StrategyNotFoundError
  | StrategyAlreadyRegisteredError
  | StrategyInitializationError
  | StrategyConfigValidationError
  | StrategyExecutionError
  | StrategyWarmupError
  | StrategyNotEnabledError
  | StrategyResourceLimitError;
