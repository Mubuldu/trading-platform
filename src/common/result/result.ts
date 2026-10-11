import { BaseError } from '@common/errors/base.error';

/**
 * Result<T, E> is the primary mechanism for expressing fallible operations
 * without throwing exceptions.
 *
 * Use Result when:
 *  - The failure is an expected business case (not found, validation failed, rule violated)
 *  - The caller MUST handle both success and failure paths explicitly
 *  - You want type-safe error propagation across async boundaries
 *
 * Do NOT use Result for:
 *  - Programming errors (null dereference, type errors) — these should throw
 *  - Truly unexpected infrastructure panics — let them propagate to the global filter
 *
 * Composition API:
 *  map(fn)        — transform the Ok value, pass Err through unchanged
 *  flatMap(fn)    — chain operations that return Result (Railway Oriented Programming)
 *  mapErr(fn)     — transform the Err value, pass Ok through unchanged
 *  match(ok, err) — exhaustively handle both branches
 *  getOrElse(d)   — get value or fallback if Err
 *  getOrThrow()   — extract value or throw the error (last resort)
 *  tap(fn)        — side-effect on Ok without changing the Result
 *  tapErr(fn)     — side-effect on Err without changing the Result
 */

export class OkResult<T, E extends BaseError> {
  readonly _tag = 'ok' as const;

  private constructor(readonly value: T) {}

  static create<T, E extends BaseError>(value: T): OkResult<T, E> {
    return new OkResult<T, E>(value);
  }

  isOk(): this is OkResult<T, E> {
    return true;
  }

  isErr(): this is ErrResult<T, E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return ok(fn(this.value));
  }

  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  mapErr<F extends BaseError>(_fn: (error: E) => F): Result<T, F> {
    return ok(this.value);
  }

  getOrElse(_defaultValue: T): T {
    return this.value;
  }

  getOrThrow(): T {
    return this.value;
  }

  match<R>(onOk: (value: T) => R, _onErr: (error: E) => R): R {
    return onOk(this.value);
  }

  tap(fn: (value: T) => void): Result<T, E> {
    fn(this.value);
    return this;
  }

  tapErr(_fn: (error: E) => void): Result<T, E> {
    return this;
  }
}

export class ErrResult<T, E extends BaseError> {
  readonly _tag = 'err' as const;

  private constructor(readonly error: E) {}

  static create<T, E extends BaseError>(error: E): ErrResult<T, E> {
    return new ErrResult<T, E>(error);
  }

  isOk(): this is OkResult<T, E> {
    return false;
  }

  isErr(): this is ErrResult<T, E> {
    return true;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return err(this.error);
  }

  flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return err(this.error);
  }

  mapErr<F extends BaseError>(fn: (error: E) => F): Result<T, F> {
    return err(fn(this.error));
  }

  getOrElse(defaultValue: T): T {
    return defaultValue;
  }

  getOrThrow(): never {
    throw this.error;
  }

  match<R>(_onOk: (value: T) => R, onErr: (error: E) => R): R {
    return onErr(this.error);
  }

  tap(_fn: (value: T) => void): Result<T, E> {
    return this;
  }

  tapErr(fn: (error: E) => void): Result<T, E> {
    fn(this.error);
    return this;
  }
}

export type Result<T, E extends BaseError = BaseError> = OkResult<T, E> | ErrResult<T, E>;

export function ok<T, E extends BaseError = BaseError>(value: T): Result<T, E> {
  return OkResult.create<T, E>(value);
}

export function err<T = never, E extends BaseError = BaseError>(error: E): Result<T, E> {
  return ErrResult.create<T, E>(error);
}

export function isOk<T, E extends BaseError>(result: Result<T, E>): result is OkResult<T, E> {
  return result._tag === 'ok';
}

export function isErr<T, E extends BaseError>(result: Result<T, E>): result is ErrResult<T, E> {
  return result._tag === 'err';
}

/**
 * Wraps a Promise in a Result, mapping any thrown error via mapError.
 * Prevents unhandled rejection propagation for expected failures.
 */
export async function fromPromise<T>(
  promise: Promise<T>,
  mapError: (error: unknown) => BaseError,
): Promise<Result<T>> {
  try {
    return ok(await promise);
  } catch (e) {
    return err(mapError(e));
  }
}

/**
 * Collects an array of Results into a Result of array.
 * Returns the first Err encountered — does not accumulate all errors.
 * For accumulation of all errors, use combineResultsAllErrors.
 */
export function combineResults<T, E extends BaseError>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (result.isErr()) {
      return err(result.error);
    }
    values.push(result.value);
  }
  return ok(values);
}
