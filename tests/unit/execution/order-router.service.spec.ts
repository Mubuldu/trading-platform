import { OrderRouterService } from '../../../src/modules/execution/application/services/order-router.service';
import { AdapterRegistry } from '../../../src/modules/exchange/adapters/adapter-registry';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import { OrderType } from '../../../src/modules/exchange/enums/order.enums';

function makeAdapter(connected = true, capabilities: Record<string, unknown> = {}) {
  return {
    getExchangeId: jest.fn().mockReturnValue(ExchangeId.PAPER_TRADING),
    isConnected: jest.fn().mockReturnValue(connected),
    getCapabilities: jest.fn().mockReturnValue({
      supportsTrailingStop: false,
      supportsReduceOnly: false,
      ...capabilities,
    }),
  };
}

describe('OrderRouterService', () => {
  let registry: AdapterRegistry;
  let service: OrderRouterService;

  beforeEach(() => {
    registry = new AdapterRegistry();
    service = new OrderRouterService(registry);
  });

  it('returns RoutingError when exchange is not recognized', () => {
    const result = service.route('unknown_exchange', OrderType.MARKET);
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('Unknown exchange');
  });

  it('returns RoutingError when no adapter is registered for exchange', () => {
    const result = service.route('paper_trading', OrderType.MARKET);
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('No adapter registered');
  });

  it('returns ExchangeNotConnectedError when adapter is not connected', () => {
    const adapter = makeAdapter(false);
    registry.register(ExchangeId.PAPER_TRADING, () => adapter as any);
    const result = service.route('paper_trading', OrderType.MARKET);
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('not connected');
  });

  it('returns ok with adapter when exchange is registered and connected', () => {
    const adapter = makeAdapter(true);
    registry.register(ExchangeId.PAPER_TRADING, () => adapter as any);
    const result = service.route('paper_trading', OrderType.MARKET);
    expect(result.isOk()).toBe(true);
  });

  it('returns CapabilityNotSupportedError for TRAILING_STOP when not supported', () => {
    const adapter = makeAdapter(true, { supportsTrailingStop: false });
    registry.register(ExchangeId.PAPER_TRADING, () => adapter as any);
    const result = service.route('paper_trading', OrderType.TRAILING_STOP);
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('supportsTrailingStop');
  });

  it('routes TRAILING_STOP when exchange supports it', () => {
    const adapter = makeAdapter(true, { supportsTrailingStop: true });
    registry.register(ExchangeId.PAPER_TRADING, () => adapter as any);
    const result = service.route('paper_trading', OrderType.TRAILING_STOP);
    expect(result.isOk()).toBe(true);
  });

  it('routes LIMIT orders without capability check', () => {
    const adapter = makeAdapter(true);
    registry.register(ExchangeId.PAPER_TRADING, () => adapter as any);
    const result = service.route('paper_trading', OrderType.LIMIT);
    expect(result.isOk()).toBe(true);
  });
});
