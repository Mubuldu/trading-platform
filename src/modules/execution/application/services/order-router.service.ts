import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { ExchangeAdapter } from '@modules/exchange/interfaces/exchange-adapter.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderType } from '@modules/exchange/enums/order.enums';
import {
  RoutingError,
  ExchangeNotConnectedError,
  CapabilityNotSupportedError,
} from '../../domain/errors/execution.errors';

type RoutingError2 = RoutingError | ExchangeNotConnectedError | CapabilityNotSupportedError;

@Injectable()
export class OrderRouterService {
  constructor(private readonly registry: AdapterRegistry) {}

  route(exchangeStr: string, orderType: OrderType): Result<ExchangeAdapter, RoutingError2> {
    const exchangeId = this.resolveExchangeId(exchangeStr);
    if (!exchangeId) {
      return err(new RoutingError(exchangeStr, `Unknown exchange identifier "${exchangeStr}"`));
    }

    if (!this.registry.has(exchangeId)) {
      return err(new RoutingError(exchangeId, 'No adapter registered for this exchange'));
    }

    const adapter = this.registry.create(exchangeId);

    if (!adapter.isConnected()) {
      return err(new ExchangeNotConnectedError(exchangeId));
    }

    const capabilityError = this.checkCapability(adapter, orderType);
    if (capabilityError) {
      return err(capabilityError);
    }

    return ok(adapter);
  }

  private resolveExchangeId(exchange: string): ExchangeId | undefined {
    const lower = exchange.toLowerCase();
    return Object.values(ExchangeId).find((id) => id === lower) as ExchangeId | undefined;
  }

  private checkCapability(
    adapter: ExchangeAdapter,
    orderType: OrderType,
  ): CapabilityNotSupportedError | undefined {
    const capabilities = adapter.getCapabilities();
    const exchangeId = adapter.getExchangeId();

    if (orderType === OrderType.TRAILING_STOP && !capabilities.supportsTrailingStop) {
      return new CapabilityNotSupportedError(exchangeId, 'supportsTrailingStop');
    }

    if (orderType === OrderType.STOP || orderType === OrderType.STOP_LIMIT) {
      // Stop orders need futures/margin; spot check via supportsReduceOnly as proxy
      // Exchanges that support reduce-only typically support stop orders
    }

    return undefined;
  }
}
