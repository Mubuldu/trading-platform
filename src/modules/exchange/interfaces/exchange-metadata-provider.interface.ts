import { Result } from '@common/result';
import { NormalizedSymbol } from '../models/common.model';
import { ExchangeInfo, SymbolInfo, RateLimitStatus } from '../models/exchange.models';
import { ExchangeError } from '../errors/exchange.error';

/**
 * ExchangeMetadataProvider supplies trading rules, precision constraints,
 * and operational status information.
 *
 * ExchangeInfo should be fetched once at startup and cached. It is refreshed
 * periodically (every 5–60 minutes depending on exchange) to pick up
 * symbol additions, delistings, and precision changes.
 *
 * getRateLimitStatus() is real-time — it returns the current consumption
 * level without making any API request (the adapter maintains this from
 * response headers).
 *
 * isMaintenanceMode() returns true when the exchange has signalled downtime.
 * Callers should stop submitting orders when this returns true.
 */
export interface ExchangeMetadataProvider {
  getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>>;
  getSymbolInfo(symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>>;
  getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>>;
  getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError>;
  isMaintenanceMode(): boolean;
}
