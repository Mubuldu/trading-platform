import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { SymbolInfo } from '@modules/exchange/models/exchange.models';
import { SubmitOrderRequest } from '@modules/exchange/models/trading.models';
import { OrderSide, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';
import { ExchangeId, MarketType } from '@modules/exchange/enums/exchange.enums';
import {
  ExchangeInvalidRequestError,
  ExchangeUnsupportedOperationError,
} from '@modules/exchange/errors/exchange.error';

const BTCUSDT = NormalizedSymbol.unsafe('BTC/USDT');
const EXCHANGE_ID = ExchangeId.BINANCE_SPOT;

const symbolInfo: SymbolInfo = {
  symbol: BTCUSDT,
  exchangeSymbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  exchangeId: EXCHANGE_ID,
  marketType: MarketType.SPOT,
  isActive: true,
  pricePrecision: 2,
  quantityPrecision: 5,
  quotePrecision: 8,
  minQuantity: 0.00001,
  maxQuantity: 9000,
  stepSize: 0.00001,
  minPrice: 0.01,
  maxPrice: 1_000_000,
  tickSize: 0.01,
  minNotional: 10,
  allowsLimitOrder: true,
  allowsMarketOrder: true,
  allowsStopOrder: true,
  allowsPostOnly: true,
  allowsReduceOnly: false,
  allowsIceberg: false,
};

const validLimitOrder: SubmitOrderRequest = {
  symbol: BTCUSDT,
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  quantity: 0.001,
  price: 50000,
  timeInForce: TimeInForce.GTC,
};

describe('OrderValidator', () => {
  let validator: OrderValidator;

  beforeEach(() => {
    validator = new OrderValidator();
  });

  describe('validate() — valid orders', () => {
    it('validates a correct limit order', () => {
      const r = validator.validate(validLimitOrder, symbolInfo, EXCHANGE_ID);
      expect(r.isOk()).toBe(true);
    });

    it('validates a correct market order (no price required)', () => {
      const order: SubmitOrderRequest = {
        symbol: BTCUSDT,
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: 0.001,
      };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isOk()).toBe(true);
    });
  });

  describe('validate() — symbol validation', () => {
    it('rejects when symbol is inactive', () => {
      const inactiveInfo = { ...symbolInfo, isActive: false };
      const r = validator.validate(validLimitOrder, inactiveInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(ExchangeInvalidRequestError);
    });
  });

  describe('validate() — quantity validation', () => {
    it('rejects quantity below minimum', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, quantity: 0.000001 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });

    it('rejects quantity above maximum', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, quantity: 99999 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });

    it('rejects quantity with too many decimal places', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, quantity: 0.000001234 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });
  });

  describe('validate() — price validation', () => {
    it('rejects limit order without price', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, price: undefined };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });

    it('rejects price with too many decimal places', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, price: 50000.123 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });

    it('rejects price below minimum', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, price: 0.001 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });
  });

  describe('validate() — notional validation', () => {
    it('rejects order below minimum notional', () => {
      const order: SubmitOrderRequest = { ...validLimitOrder, quantity: 0.0001, price: 50 };
      const r = validator.validate(order, symbolInfo, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
    });
  });

  describe('validate() — order type capability', () => {
    it('rejects LIMIT order when not allowed', () => {
      const info = { ...symbolInfo, allowsLimitOrder: false };
      const r = validator.validate(validLimitOrder, info, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
    });

    it('rejects POST_ONLY when not allowed', () => {
      const info = { ...symbolInfo, allowsPostOnly: false };
      const order: SubmitOrderRequest = { ...validLimitOrder, timeInForce: TimeInForce.POST_ONLY };
      const r = validator.validate(order, info, EXCHANGE_ID);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
    });
  });
});
