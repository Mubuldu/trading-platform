import { ApplicationError } from '@common/errors/application.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export class BacktestConfigInvalidError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_CONFIG_INVALID;
  constructor(reason: string) {
    super(`Backtest configuration is invalid: ${reason}`);
  }
}

export class BacktestDataLoadFailedError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_DATA_LOAD_FAILED;
  constructor(source: string, reason: string) {
    super(`Failed to load historical data from ${source}: ${reason}`);
  }
}

export class BacktestDataEmptyError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_DATA_EMPTY;
  constructor(symbol: string, timeframe: string, startTime: number, endTime: number) {
    super(
      `No historical candles found for ${symbol} (${timeframe}) between ${new Date(startTime).toISOString()} and ${new Date(endTime).toISOString()}`,
    );
  }
}

export class BacktestDataCorruptError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_DATA_CORRUPT;
  constructor(reason: string, lineNumber?: number) {
    const location = lineNumber != null ? ` at line ${lineNumber}` : '';
    super(`Historical data is corrupt${location}: ${reason}`);
  }
}

export class BacktestStrategyLoadFailedError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_STRATEGY_LOAD_FAILED;
  constructor(strategyType: string, reason: string) {
    super(`Failed to load strategy "${strategyType}" for backtest: ${reason}`);
  }
}

export class BacktestSessionNotFoundError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_SESSION_NOT_FOUND;
  constructor(sessionId: string) {
    super(`Backtest session "${sessionId}" not found`);
  }
}

export class BacktestAlreadyRunningError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_ALREADY_RUNNING;
  constructor(sessionId: string) {
    super(`Backtest session "${sessionId}" is already running`);
  }
}

export class BacktestCancelledError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_CANCELLED;
  constructor(sessionId: string) {
    super(`Backtest session "${sessionId}" was cancelled`);
  }
}

export class BacktestInsufficientCapitalError extends ApplicationError {
  readonly code = ErrorCode.BACKTEST_INSUFFICIENT_CAPITAL;
  constructor(required: number, available: number) {
    super(
      `Insufficient capital: required $${required.toFixed(2)}, available $${available.toFixed(2)}`,
    );
  }
}
