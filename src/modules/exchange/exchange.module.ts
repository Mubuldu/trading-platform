import { Module } from '@nestjs/common';
import { AdapterRegistry } from './adapters/adapter-registry';
import { ExchangeFactory } from './factories/exchange.factory';
import { ExchangeRegistry } from './registry/exchange-registry';
import { ExchangeRouter } from './router/exchange-router';
import { SymbolNormalizer } from './normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from './normalizers/order-status.normalizer';
import { OrderValidator } from './validators/order.validator';
import { MarketDataEventBus } from './market-data-event-bus';

/**
 * ExchangeModule provides the full multi-exchange abstraction layer.
 *
 * This module is NOT global — only modules that need exchange access import it.
 * That means ExecutionModule, MarketDataModule, PortfolioModule, etc.
 *
 * ── Core infrastructure ───────────────────────────────────────────────────
 *
 *   AdapterRegistry   — stores adapter factory functions; singleton per ExchangeId
 *   ExchangeFactory   — creates / retrieves adapters from AdapterRegistry
 *   ExchangeRegistry  — enhanced registry; adds enable/disable, health tracking,
 *                       and capability discovery over AdapterRegistry
 *   ExchangeRouter    — routes RouteContext → ExchangeAdapter; the primary
 *                       entry point for exchange-agnostic code
 *
 * ── Shared utilities ──────────────────────────────────────────────────────
 *
 *   SymbolNormalizer      — bidirectional symbol translation (all exchanges)
 *   OrderStatusNormalizer — maps exchange-specific status strings to OrderStatus
 *   OrderValidator        — validates orders against SymbolInfo before submission
 *   MarketDataEventBus    — internal event bus for normalized market data streams
 *
 * ── How multi-exchange routing works ─────────────────────────────────────
 *
 *   Strategies and business modules use ExchangeRouter:
 *
 *     const result = router.route({ symbol, requiredCapabilities: ['supportsSpot'] });
 *     if (result.isErr()) return result;           // no exchange available
 *     const adapter = result.value;               // exchange-agnostic adapter
 *
 *   The router selects among all enabled exchanges, applies failover policies,
 *   and checks capability requirements — the caller never knows which exchange
 *   is behind the adapter.
 *
 * ── Adding a new exchange ─────────────────────────────────────────────────
 *
 *   1. Add ExchangeId to exchange.enums.ts.
 *   2. Create the adapter (see docs/exchange-adapter-guide.md).
 *   3. Create an exchange module (e.g. BybitModule).
 *   4. In onModuleInit(), call adapterRegistry.register() + exchangeRegistry.enable().
 *   5. Import the exchange module in AppModule.
 *   Nothing in this file changes.
 */
@Module({
  providers: [
    AdapterRegistry,
    ExchangeFactory,
    ExchangeRegistry,
    ExchangeRouter,
    SymbolNormalizer,
    OrderStatusNormalizer,
    OrderValidator,
    MarketDataEventBus,
  ],
  exports: [
    // Factory layer (used by existing code that explicitly picks an exchange)
    ExchangeFactory,
    AdapterRegistry,
    // Registry + Router (multi-exchange routing)
    ExchangeRegistry,
    ExchangeRouter,
    // Shared utilities
    SymbolNormalizer,
    OrderStatusNormalizer,
    OrderValidator,
    MarketDataEventBus,
  ],
})
export class ExchangeModule {}
