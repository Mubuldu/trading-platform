import { Result } from '@common/result';
import { Balance, AccountInfo, FeeRates, TradingPermission } from '../models/account.models';
import { NormalizedSymbol } from '../models/common.model';
import { ExchangeError } from '../errors/exchange.error';

/**
 * AccountProvider retrieves account-level information.
 *
 * All methods make REST requests — there is no streaming equivalent for
 * account data in most exchanges. Poll cautiously to respect rate limits.
 *
 * Caching: balances should be cached and invalidated on each execution
 * report, not polled on every order. The risk engine subscribes to
 * execution reports to maintain a real-time balance estimate.
 */
export interface AccountProvider {
  getBalance(): Promise<Result<Balance, ExchangeError>>;
  getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>>;
  getFeeRates(symbol?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>>;
  getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>>;
}
