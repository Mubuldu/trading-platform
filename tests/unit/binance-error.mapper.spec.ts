import { BinanceErrorMapper } from '@modules/exchange/adapters/binance/mappers/binance-error.mapper';
import {
  AuthenticationError,
  RateLimitError,
  InsufficientBalanceError,
  OrderRejectedError,
  ExchangeNetworkFailureError,
  UnknownSymbolError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';

describe('BinanceErrorMapper', () => {
  let mapper: BinanceErrorMapper;

  beforeEach(() => {
    mapper = new BinanceErrorMapper();
  });

  describe('fromHttpResponse() — HTTP status codes', () => {
    it('maps HTTP 429 to RateLimitError (retryable)', () => {
      const error = mapper.fromHttpResponse(429, '{}', {});
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('maps HTTP 418 (IP ban) to RateLimitError with long retry', () => {
      const error = mapper.fromHttpResponse(418, '{}', { retryAfterSec: 3600 });
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterMs).toBe(3_600_000);
    });

    it('maps HTTP 500 to retryable ExchangeNetworkFailureError', () => {
      const error = mapper.fromHttpResponse(500, 'Internal Server Error', {});
      expect(error).toBeInstanceOf(ExchangeNetworkFailureError);
      expect(error.isRetryable).toBe(true);
    });

    it('maps HTTP 502 to retryable ExchangeNetworkFailureError', () => {
      const error = mapper.fromHttpResponse(502, 'Bad Gateway', {});
      expect(error).toBeInstanceOf(ExchangeNetworkFailureError);
      expect(error.isRetryable).toBe(true);
    });

    it('uses retryAfterSec header for 429 when available', () => {
      const error = mapper.fromHttpResponse(429, '{}', { retryAfterSec: 30 });
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterMs).toBe(30_000);
    });
  });

  describe('fromHttpResponse() — Binance error codes in body', () => {
    it('maps -1022 (invalid signature) to AuthenticationError', () => {
      const body = JSON.stringify({ code: -1022, msg: 'Signature for this request is not valid.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('maps -2014 (bad apikey format) to AuthenticationError', () => {
      const body = JSON.stringify({ code: -2014, msg: 'API-key format invalid.' });
      const error = mapper.fromHttpResponse(401, body, {});
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('maps -1121 (invalid symbol) to UnknownSymbolError', () => {
      const body = JSON.stringify({ code: -1121, msg: 'Invalid symbol.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(UnknownSymbolError);
    });

    it('maps -1003 (rate limit) to RateLimitError', () => {
      const body = JSON.stringify({ code: -1003, msg: 'Too much request weight used.' });
      const error = mapper.fromHttpResponse(429, body, {});
      expect(error).toBeInstanceOf(RateLimitError);
    });

    it('maps -2010 (order rejected/insufficient balance) to OrderRejectedError', () => {
      const body = JSON.stringify({
        code: -2010,
        msg: 'Account has insufficient balance for requested action.',
      });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(OrderRejectedError);
    });

    it('maps -2018 (insufficient balance) to InsufficientBalanceError', () => {
      const body = JSON.stringify({ code: -2018, msg: 'Balance is insufficient.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(InsufficientBalanceError);
    });

    it('maps -2013 (no such order) to OrderRejectedError', () => {
      const body = JSON.stringify({ code: -2013, msg: 'Order does not exist.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(OrderRejectedError);
    });

    it('maps unknown code to ExchangeInvalidRequestError as fallback', () => {
      const body = JSON.stringify({ code: -9999, msg: 'Unrecognized error.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error).toBeInstanceOf(ExchangeInvalidRequestError);
    });

    it('handles malformed JSON body gracefully', () => {
      const error = mapper.fromHttpResponse(400, 'not-json', {});
      expect(error).toBeInstanceOf(ExchangeNetworkFailureError);
    });
  });

  describe('error attributes', () => {
    it('all errors carry exchangeId = BINANCE_SPOT', () => {
      const body = JSON.stringify({ code: -1022, msg: 'test' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error.exchangeId).toBe('binance_spot');
    });

    it('rawMessage is set on errors', () => {
      const body = JSON.stringify({ code: -1022, msg: 'Signature for this request is not valid.' });
      const error = mapper.fromHttpResponse(400, body, {});
      expect(error.rawMessage).toBeDefined();
    });

    it('authentication errors are NOT retryable', () => {
      const body = JSON.stringify({ code: -1022, msg: 'Invalid signature.' });
      const error = mapper.fromHttpResponse(401, body, {});
      expect(error.isRetryable).toBe(false);
    });

    it('network failures ARE retryable', () => {
      const error = mapper.fromHttpResponse(503, 'Service Unavailable', {});
      expect(error.isRetryable).toBe(true);
    });
  });
});
