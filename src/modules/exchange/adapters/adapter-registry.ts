import { Injectable } from '@nestjs/common';
import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { ExchangeId } from '../enums/exchange.enums';

type AdapterCreator = () => ExchangeAdapter;

/**
 * AdapterRegistry is the central registry of all available exchange adapters.
 *
 * The registry separates adapter construction from adapter usage:
 *  - Adapters register a creator factory (a zero-argument function) during
 *    module initialization, before any requests are made.
 *  - At request time, the ExchangeFactory calls registry.create() which
 *    invokes the creator and returns a fresh or cached adapter instance.
 *
 * This milestone: no real adapters are registered. The registry is empty.
 * Future milestones register adapters in their own modules:
 *
 *   // In BinanceModule.onModuleInit():
 *   registry.register(ExchangeId.BINANCE_SPOT, () => new BinanceSpotAdapter(...));
 *
 * The registry holds a singleton per ExchangeId once an instance is created.
 * Calling create() twice returns the same instance (first-creation semantics).
 */
@Injectable()
export class AdapterRegistry {
  private readonly creators = new Map<ExchangeId, AdapterCreator>();
  private readonly instances = new Map<ExchangeId, ExchangeAdapter>();

  register(exchangeId: ExchangeId, creator: AdapterCreator): void {
    if (this.creators.has(exchangeId)) {
      throw new Error(
        `Adapter for "${exchangeId}" is already registered. Each ExchangeId may only have one adapter.`,
      );
    }
    this.creators.set(exchangeId, creator);
  }

  create(exchangeId: ExchangeId): ExchangeAdapter {
    const existing = this.instances.get(exchangeId);
    if (existing) return existing;

    const creator = this.creators.get(exchangeId);
    if (!creator) {
      throw new Error(
        `No adapter registered for exchange "${exchangeId}". Call has() before create().`,
      );
    }

    const adapter = creator();
    this.instances.set(exchangeId, adapter);
    return adapter;
  }

  has(exchangeId: ExchangeId): boolean {
    return this.creators.has(exchangeId);
  }

  isInstantiated(exchangeId: ExchangeId): boolean {
    return this.instances.has(exchangeId);
  }

  getSupportedExchanges(): ExchangeId[] {
    return [...this.creators.keys()];
  }

  getActiveAdapters(): ExchangeAdapter[] {
    return [...this.instances.values()];
  }
}
