import { Result, ok, err } from '@common/result';
import { ExchangeError } from '../errors/exchange.error';
import { ExchangeId } from '../enums/exchange.enums';
import { ExchangeInvalidRequestError } from '../errors/exchange.error';

/**
 * BaseMapper<TRaw, TNormalized> is the contract for translating raw exchange
 * API responses into normalized platform models.
 *
 * Responsibilities:
 *  - Parse raw exchange data
 *  - Apply precision normalization
 *  - Set timestamps (receivedAt = now, timestamp = exchange server time)
 *  - Return ExchangeInvalidRequestError if data is malformed
 *
 * Rules for all mapper implementations:
 *  1. Never throw — return Err on parse failure
 *  2. Never log raw exchange data (may contain secrets or large payloads)
 *  3. Never store state — mappers are pure transformations
 *  4. Set receivedAt to the time of mapping, not from the exchange response
 *  5. Always validate that required fields are present before accessing them
 *
 * The `exchangeId` is passed to error construction so errors are attributed
 * to the correct exchange in logs and monitoring.
 */
export interface BaseMapper<TRaw, TNormalized> {
  readonly exchangeId: ExchangeId;
  map(raw: TRaw): Result<TNormalized, ExchangeError>;
  mapMany(rawItems: TRaw[]): Result<TNormalized[], ExchangeError>;
}

/**
 * AbstractMapper provides the mapMany implementation which runs map() on
 * each item and returns the first error encountered.
 *
 * Extend this and implement map() for concrete exchange-specific mappers.
 */
export abstract class AbstractMapper<TRaw, TNormalized> implements BaseMapper<TRaw, TNormalized> {
  abstract readonly exchangeId: ExchangeId;
  abstract map(raw: TRaw): Result<TNormalized, ExchangeError>;

  mapMany(rawItems: TRaw[]): Result<TNormalized[], ExchangeError> {
    const results: TNormalized[] = [];
    for (const item of rawItems) {
      const result = this.map(item);
      if (result.isErr()) return err(result.error);
      results.push(result.value);
    }
    return ok(results);
  }

  protected requireField<T>(obj: Record<string, unknown>, field: string): Result<T, ExchangeError> {
    const value = obj[field];
    if (value === undefined || value === null) {
      return err(
        new ExchangeInvalidRequestError(
          this.exchangeId,
          `Required field "${field}" is missing in exchange response`,
          { field, receivedKeys: Object.keys(obj) },
        ),
      );
    }
    return ok(value as T);
  }

  protected parseFloat(value: unknown, fieldName: string): Result<number, ExchangeError> {
    const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (isNaN(parsed)) {
      return err(
        new ExchangeInvalidRequestError(
          this.exchangeId,
          `Field "${fieldName}" is not a valid number: ${String(value)}`,
          { fieldName, value: String(value) },
        ),
      );
    }
    return ok(parsed);
  }

  protected parseDate(value: unknown, fieldName: string): Result<Date, ExchangeError> {
    let ms: number;
    if (typeof value === 'number') {
      ms = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      ms = parseInt(value, 10);
    } else {
      ms = NaN;
    }
    if (isNaN(ms)) {
      return err(
        new ExchangeInvalidRequestError(
          this.exchangeId,
          `Field "${fieldName}" is not a valid unix millisecond timestamp: ${String(value)}`,
          { fieldName, value: String(value) },
        ),
      );
    }
    return ok(new Date(ms));
  }
}
