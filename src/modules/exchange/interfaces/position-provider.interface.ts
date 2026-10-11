import { Result } from '@common/result';
import { Position } from '../models/account.models';
import { NormalizedSymbol } from '../models/common.model';
import { MarginMode, PositionMode, PositionSide } from '../enums/position.enums';
import { ExchangeError } from '../errors/exchange.error';

export interface SetLeverageRequest {
  readonly symbol: NormalizedSymbol;
  readonly leverage: number;
}

export interface SetMarginModeRequest {
  readonly symbol: NormalizedSymbol;
  readonly marginMode: MarginMode;
}

export interface AdjustMarginRequest {
  readonly symbol: NormalizedSymbol;
  readonly positionSide: PositionSide;
  readonly amount: number;
  readonly direction: 'ADD' | 'REDUCE';
}

/**
 * PositionProvider manages futures/margin position queries and configuration.
 *
 * Available only when the exchange supports futures or margin trading.
 * All methods on a spot-only exchange return ExchangeUnsupportedOperationError.
 *
 * Leverage and margin mode changes take effect immediately and affect ALL
 * open and future positions for the given symbol. These are dangerous
 * operations — the risk engine must approve them before execution.
 */
export interface PositionProvider {
  getOpenPositions(symbol?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>>;
  getPositionHistory(
    symbol: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Position[], ExchangeError>>;
  getPositionMode(): Promise<Result<PositionMode, ExchangeError>>;
  setPositionMode(mode: PositionMode): Promise<Result<void, ExchangeError>>;
  getLeverage(symbol: NormalizedSymbol): Promise<Result<number, ExchangeError>>;
  setLeverage(request: SetLeverageRequest): Promise<Result<number, ExchangeError>>;
  getMarginMode(symbol: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>>;
  setMarginMode(request: SetMarginModeRequest): Promise<Result<void, ExchangeError>>;
  adjustMargin(request: AdjustMarginRequest): Promise<Result<void, ExchangeError>>;
}
