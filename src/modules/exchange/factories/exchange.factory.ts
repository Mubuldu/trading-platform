import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { ExchangeId } from '../enums/exchange.enums';
import { AdapterRegistry } from '../adapters/adapter-registry';
import {
  ExchangeConnectionError,
  ExchangeUnsupportedOperationError,
} from '../errors/exchange.error';
import { ExchangeError } from '../errors/exchange.error';

export interface ExchangeFactoryOptions {
  readonly exchangeId: ExchangeId;
  readonly testnet?: boolean;
  readonly autoInitialize?: boolean;
}

/**
 * ExchangeFactory is the single entry point for obtaining exchange adapters.
 *
 * The factory:
 *  1. Checks that the requested ExchangeId has a registered adapter
 *  2. Delegates construction to the AdapterRegistry
 *  3. Optionally calls initialize() on the adapter (fetches ExchangeInfo,
 *     seeds the SymbolNormalizer, establishes connections)
 *  4. Returns a Result — callers must handle the case where the exchange
 *     is unavailable or unconfigured
 *
 * The factory does NOT hold adapter instances — the registry does.
 * Calling create() with the same ExchangeId always returns the same adapter.
 *
 * Consumers that need a specific provider interface (not the full adapter)
 * should type the return value:
 *
 *   const adapter = factory.create({ exchangeId: ExchangeId.BINANCE_SPOT });
 *   const marketData: MarketDataProvider = adapter;
 *
 * This preserves Interface Segregation while allowing a single factory call.
 *
 * Adding a new exchange:
 *  1. Create the adapter class (extends BaseExchangeAdapter)
 *  2. Add the ExchangeId to exchange.enums.ts
 *  3. Register the creator in the adapter's own NestJS module:
 *       registry.register(ExchangeId.MY_EXCHANGE, () => new MyAdapter(...))
 *  4. Import the adapter module in the application module
 *  No changes to ExchangeFactory, ExchangeModule, or any other file.
 */
@Injectable()
export class ExchangeFactory {
  private readonly context = ExchangeFactory.name;

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly logger: AppLoggerService,
  ) {}

  async create(options: ExchangeFactoryOptions): Promise<Result<ExchangeAdapter, ExchangeError>> {
    const { exchangeId, autoInitialize = true } = options;

    if (!this.registry.has(exchangeId)) {
      return err(
        new ExchangeUnsupportedOperationError(
          exchangeId,
          `No adapter registered for "${exchangeId}". Register one via AdapterRegistry.register().`,
        ),
      );
    }

    let adapter: ExchangeAdapter;
    try {
      adapter = this.registry.create(exchangeId);
    } catch (e) {
      return err(new ExchangeConnectionError(exchangeId, e instanceof Error ? e : undefined));
    }

    if (autoInitialize && !this.registry.isInstantiated(exchangeId)) {
      this.logger.log(`Initializing adapter for ${exchangeId}`, this.context);
      const initResult = await adapter.initialize();
      if (initResult.isErr()) {
        this.logger.error(
          `Failed to initialize adapter for ${exchangeId}: ${initResult.error.message}`,
          initResult.error.stack,
          this.context,
        );
        return err(initResult.error);
      }
    }

    return ok(adapter);
  }

  createSync(exchangeId: ExchangeId): Result<ExchangeAdapter, ExchangeError> {
    if (!this.registry.has(exchangeId)) {
      return err(
        new ExchangeUnsupportedOperationError(
          exchangeId,
          `No adapter registered for "${exchangeId}"`,
        ),
      );
    }

    try {
      return ok(this.registry.create(exchangeId));
    } catch (e) {
      return err(new ExchangeConnectionError(exchangeId, e instanceof Error ? e : undefined));
    }
  }

  supports(exchangeId: ExchangeId): boolean {
    return this.registry.has(exchangeId);
  }

  getSupportedExchanges(): ExchangeId[] {
    return this.registry.getSupportedExchanges();
  }

  getActiveAdapters(): ExchangeAdapter[] {
    return this.registry.getActiveAdapters();
  }
}
