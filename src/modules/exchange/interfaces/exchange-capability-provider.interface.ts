import { ExchangeCapabilities } from '../models/exchange.models';
import { ExchangeId } from '../enums/exchange.enums';

/**
 * ExchangeCapabilityProvider exposes which features an exchange supports.
 *
 * Consumers MUST check capabilities before calling provider methods that
 * may not be universally supported. Failure to check may result in runtime
 * errors when switching exchanges.
 *
 * Example usage:
 *   if (!adapter.getCapabilities().supportsBatchOrders) {
 *     // fall back to sequential single-order submission
 *   }
 */
export interface ExchangeCapabilityProvider {
  getExchangeId(): ExchangeId;
  getCapabilities(): ExchangeCapabilities;
  isFeatureSupported(feature: keyof ExchangeCapabilities): boolean;
}
