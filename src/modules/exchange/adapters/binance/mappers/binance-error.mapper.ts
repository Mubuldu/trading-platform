import { Injectable } from '@nestjs/common';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import {
  ExchangeError,
  AuthenticationError,
  RateLimitError,
  InsufficientBalanceError,
  OrderRejectedError,
  ExchangeMaintenanceError,
  UnknownSymbolError,
  ExchangeNetworkFailureError,
  ExchangeConnectionError,
  ExchangeInvalidRequestError,
  ExchangePermissionDeniedError,
  ExchangeDuplicateOrderError,
  ExchangeUnsupportedOperationError,
} from '@modules/exchange/errors/exchange.error';
import {
  BINANCE_RATE_LIMIT_CODES,
  BINANCE_AUTH_ERROR_CODES,
  BINANCE_RETRYABLE_HTTP_STATUSES,
} from '../config/binance.constants';
import { BinanceResponseHeaders, BinanceRawErrorBody } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

/**
 * BinanceErrorMapper translates Binance HTTP responses into normalized
 * ExchangeError subclasses.
 *
 * Binance error responses have two layers:
 *  1. HTTP status code (400, 401, 403, 404, 409, 418, 429, 5xx)
 *  2. JSON body: { "code": -XXXXX, "msg": "description" }
 *
 * The mapping strategy:
 *  - HTTP 429 / code -1003: RateLimitError (retryable)
 *  - HTTP 418: RateLimitError with long retry (IP ban — retryable after penalty)
 *  - HTTP 5xx: ExchangeNetworkFailureError (retryable)
 *  - code -1022/-2014/-2015: AuthenticationError
 *  - code -1021: ExchangeInvalidRequestError (timestamp drift — sync then retry)
 *  - code -1121: UnknownSymbolError
 *  - code -2010/-2011/-2013: OrderRejectedError
 *  - code -2018: InsufficientBalanceError
 *  - Default: ExchangeInvalidRequestError
 *
 * The `rawMessage` field carries the original Binance message for diagnostics.
 * It MUST NOT be forwarded to end-users — it may contain internal details.
 */
@Injectable()
export class BinanceErrorMapper {
  fromHttpResponse(
    statusCode: number,
    responseBody: string,
    headers: BinanceResponseHeaders,
  ): ExchangeError {
    const body = this.tryParseBody(responseBody);

    // IP auto-ban — very long penalty period
    if (statusCode === 418) {
      const retryAfterMs = (headers.retryAfterSec ?? 3600) * 1_000;
      return new RateLimitError(EX, retryAfterMs, undefined, body?.msg);
    }

    // Standard rate limit
    if (statusCode === 429 || (body && BINANCE_RATE_LIMIT_CODES.has(body.code))) {
      const retryAfterMs = headers.retryAfterSec ? headers.retryAfterSec * 1_000 : 60_000;
      return new RateLimitError(EX, retryAfterMs, undefined, body?.msg);
    }

    // Retryable server errors
    if (BINANCE_RETRYABLE_HTTP_STATUSES.has(statusCode)) {
      return new ExchangeNetworkFailureError(EX, undefined, body?.msg ?? `HTTP ${statusCode}`);
    }

    if (!body) {
      return new ExchangeNetworkFailureError(EX, undefined, `HTTP ${statusCode}: ${responseBody}`);
    }

    return this.fromBinanceCode(body);
  }

  fromBinanceCode(body: BinanceRawErrorBody): ExchangeError {
    const { code, msg } = body;

    // Authentication errors
    if (BINANCE_AUTH_ERROR_CODES.has(code)) {
      return new AuthenticationError(EX, undefined, msg);
    }

    // Invalid timestamp — client clock drift
    if (code === -1021) {
      return new ExchangeInvalidRequestError(
        EX,
        'Request timestamp out of server recvWindow — clock drift detected, re-syncing',
        { binanceCode: code },
        msg,
      );
    }

    // Rate limits
    if (BINANCE_RATE_LIMIT_CODES.has(code) || code === -1015) {
      return new RateLimitError(EX, 60_000, { binanceCode: code }, msg);
    }

    // Service unavailable / maintenance
    if (code === -1016) {
      return new ExchangeMaintenanceError(EX, undefined, msg);
    }

    // Unknown / invalid symbol
    if (code === -1121) {
      return new UnknownSymbolError(EX, NormalizedSymbol.unsafe(msg), msg);
    }

    // Order rejected (insufficient balance)
    if (code === -2010) {
      return new OrderRejectedError(
        EX,
        NormalizedSymbol.unsafe('unknown'),
        msg,
        { binanceCode: code },
        msg,
      );
    }

    // Cancel rejected
    if (code === -2011) {
      return new OrderRejectedError(
        EX,
        NormalizedSymbol.unsafe('unknown'),
        'Cancel rejected by exchange',
        { binanceCode: code },
        msg,
      );
    }

    // No such order
    if (code === -2013) {
      return new OrderRejectedError(
        EX,
        NormalizedSymbol.unsafe('unknown'),
        'Order does not exist',
        { binanceCode: code },
        msg,
      );
    }

    // Duplicate order
    if (code === -2022) {
      return new ExchangeDuplicateOrderError(EX, 'unknown', msg);
    }

    // Insufficient balance (explicit)
    if (code === -2018 || code === -2019) {
      return new InsufficientBalanceError(EX, 'unknown', 0, 0, msg);
    }

    // Permission denied
    if (code === -2027 || code === -3044) {
      return new ExchangePermissionDeniedError(EX, msg, msg);
    }

    // Unsupported operation
    if (code === -1020) {
      return new ExchangeUnsupportedOperationError(EX, msg, msg);
    }

    // Connectivity issues
    if (code === -1000 || code === -1006 || code === -1007) {
      return new ExchangeConnectionError(EX, undefined, msg);
    }

    // Everything else: malformed request
    return new ExchangeInvalidRequestError(EX, msg, { binanceCode: code }, msg);
  }

  private tryParseBody(body: string): BinanceRawErrorBody | null {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'code' in parsed &&
        'msg' in parsed &&
        typeof (parsed as { code: unknown }).code === 'number' &&
        typeof (parsed as { msg: unknown }).msg === 'string'
      ) {
        return parsed as BinanceRawErrorBody;
      }
      return null;
    } catch {
      return null;
    }
  }
}
