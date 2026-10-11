import { Result } from '@common/result';
import { ExchangeError } from '../errors/exchange.error';
import { ExchangeId } from '../enums/exchange.enums';
import { MarketDataProvider } from './market-data-provider.interface';
import { TradingProvider } from './trading-provider.interface';
import { AccountProvider } from './account-provider.interface';
import { PositionProvider } from './position-provider.interface';
import { OrderProvider } from './order-provider.interface';
import { ExchangeMetadataProvider } from './exchange-metadata-provider.interface';
import { ExchangeCapabilityProvider } from './exchange-capability-provider.interface';

/**
 * ExchangeAdapter is the composite interface that every exchange adapter
 * must implement.
 *
 * It extends all seven focused provider interfaces. Consumers that only
 * need a subset inject only the specific provider interface (e.g. inject
 * MarketDataProvider, not ExchangeAdapter). This maintains Interface
 * Segregation and makes test doubles minimal.
 *
 * The adapter controls its own connection lifecycle. Multiple modules may
 * share a single adapter instance via DI if they use the same exchange.
 * The AdapterRegistry holds the single instance per ExchangeId.
 *
 * initialize(): fetches ExchangeInfo, seeds the SymbolNormalizer, and
 * connects WebSocket feeds. Called once after the DI container is built.
 *
 * destroy(): disconnects all feeds and releases resources. Called during
 * graceful shutdown.
 *
 * Health: adapters expose their connection state for the HealthCheckRegistry.
 */
export interface ExchangeAdapter
  extends
    MarketDataProvider,
    TradingProvider,
    AccountProvider,
    PositionProvider,
    OrderProvider,
    ExchangeMetadataProvider,
    ExchangeCapabilityProvider {
  readonly exchangeId: ExchangeId;

  initialize(): Promise<Result<void, ExchangeError>>;
  destroy(): Promise<void>;
  healthCheck(): Promise<Result<string, ExchangeError>>;
}
