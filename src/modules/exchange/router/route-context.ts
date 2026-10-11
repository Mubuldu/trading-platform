import { ExchangeId, MarketType } from '../enums/exchange.enums';
import { ExchangeCapabilities } from '../models/exchange.models';
import { NormalizedSymbol } from '../models/common.model';

/**
 * RouteContext carries everything the ExchangeRouter needs to select the
 * correct adapter for an operation.
 *
 * Strategies build a RouteContext and pass it to ExchangeRouter.route().
 * They never reference an ExchangeId directly — that is the core of the
 * exchange-agnostic contract.
 *
 * Fields:
 *  symbol               — the instrument to trade (in normalized BTC/USDT format)
 *  marketType           — spot, perpetual, futures, options, margin
 *  requiredCapabilities — capabilities the chosen exchange MUST declare
 *  preferredExchangeId  — soft preference; the router honors it unless the
 *                         exchange is disabled, in maintenance, or in failover
 *  accountId            — optional sub-account selector for exchanges that
 *                         support multiple API key contexts per account
 *
 * Usage examples:
 *
 *   // Strategy only knows it wants a perpetual BTC market with reduce-only:
 *   const ctx: RouteContext = {
 *     symbol: btcSymbol,
 *     marketType: MarketType.PERPETUAL,
 *     requiredCapabilities: ['supportsReduceOnly', 'supportsPerpetual'],
 *   };
 *
 *   // Execution engine with an explicit exchange configured:
 *   const ctx: RouteContext = {
 *     symbol: btcSymbol,
 *     preferredExchangeId: ExchangeId.BINANCE_FUTURES_USDT,
 *   };
 */
export interface RouteContext {
  readonly symbol?: NormalizedSymbol;
  readonly marketType?: MarketType;
  readonly requiredCapabilities?: ReadonlyArray<keyof ExchangeCapabilities>;
  readonly preferredExchangeId?: ExchangeId;
  readonly accountId?: string;
}
