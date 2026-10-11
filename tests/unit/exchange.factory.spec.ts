import { ExchangeFactory } from '@modules/exchange/factories/exchange.factory';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeUnsupportedOperationError } from '@modules/exchange/errors/exchange.error';
import { AppLoggerService } from '@core/logging/app-logger.service';

function makeLogger(): AppLoggerService {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    info: jest.fn(),
    critical: jest.fn(),
    fatal: jest.fn(),
  } as unknown as AppLoggerService;
}

describe('ExchangeFactory', () => {
  let registry: AdapterRegistry;
  let factory: ExchangeFactory;

  beforeEach(() => {
    registry = new AdapterRegistry();
    factory = new ExchangeFactory(registry, makeLogger());
  });

  describe('supports()', () => {
    it('returns false when no adapters are registered', () => {
      expect(factory.supports(ExchangeId.BINANCE_SPOT)).toBe(false);
    });

    it('returns true when an adapter is registered', () => {
      const mockAdapter = { initialize: jest.fn().mockResolvedValue({ isOk: () => true }) };
      registry.register(
        ExchangeId.BINANCE_SPOT,
        () => mockAdapter as unknown as ReturnType<typeof registry.create>,
      );
      expect(factory.supports(ExchangeId.BINANCE_SPOT)).toBe(true);
    });
  });

  describe('getSupportedExchanges()', () => {
    it('returns empty array when no adapters registered', () => {
      expect(factory.getSupportedExchanges()).toEqual([]);
    });

    it('returns registered exchange IDs', () => {
      const mockAdapter = { initialize: jest.fn().mockResolvedValue({ isOk: () => true }) };
      registry.register(
        ExchangeId.BYBIT_SPOT,
        () => mockAdapter as unknown as ReturnType<typeof registry.create>,
      );
      expect(factory.getSupportedExchanges()).toContain(ExchangeId.BYBIT_SPOT);
    });
  });

  describe('create()', () => {
    it('returns ExchangeUnsupportedOperationError for unregistered exchange', async () => {
      const r = await factory.create({
        exchangeId: ExchangeId.BINANCE_SPOT,
        autoInitialize: false,
      });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
    });

    it('returns the adapter for a registered exchange', async () => {
      const mockAdapter = {
        initialize: jest.fn().mockResolvedValue({ isOk: () => true, isErr: () => false }),
        isConnected: jest.fn().mockReturnValue(false),
      };
      registry.register(
        ExchangeId.PAPER_TRADING,
        () => mockAdapter as unknown as ReturnType<typeof registry.create>,
      );

      const r = await factory.create({
        exchangeId: ExchangeId.PAPER_TRADING,
        autoInitialize: false,
      });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toBe(mockAdapter);
      }
    });

    it('returns the same instance on multiple calls (registry singleton)', async () => {
      const mockAdapter = {
        initialize: jest.fn().mockResolvedValue({ isOk: () => true, isErr: () => false }),
      };
      registry.register(
        ExchangeId.PAPER_TRADING,
        () => mockAdapter as unknown as ReturnType<typeof registry.create>,
      );

      const r1 = await factory.create({
        exchangeId: ExchangeId.PAPER_TRADING,
        autoInitialize: false,
      });
      const r2 = await factory.create({
        exchangeId: ExchangeId.PAPER_TRADING,
        autoInitialize: false,
      });

      expect(r1.isOk() && r2.isOk()).toBe(true);
      if (r1.isOk() && r2.isOk()) {
        expect(r1.value).toBe(r2.value);
      }
    });
  });

  describe('createSync()', () => {
    it('returns error for unregistered exchange', () => {
      const r = factory.createSync(ExchangeId.BINANCE_FUTURES_USDT);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
    });
  });

  describe('AdapterRegistry', () => {
    it('throws when registering the same exchange twice', () => {
      const mockAdapter = {};
      registry.register(
        ExchangeId.BYBIT_LINEAR,
        () => mockAdapter as unknown as ReturnType<typeof registry.create>,
      );
      expect(() =>
        registry.register(
          ExchangeId.BYBIT_LINEAR,
          () => mockAdapter as unknown as ReturnType<typeof registry.create>,
        ),
      ).toThrow();
    });
  });
});
