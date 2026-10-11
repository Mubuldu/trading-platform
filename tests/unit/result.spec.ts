import {
  ok,
  err,
  isOk,
  isErr,
  fromPromise,
  combineResults,
  OkResult,
  ErrResult,
} from '@common/result';
import { BaseError } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';
import { NotFoundError } from '@domain/errors/domain.error';
import { DatabaseError } from '@common/errors/infrastructure.error';

class TestError extends BaseError {
  readonly code = ErrorCode.DOMAIN_NOT_FOUND;
  readonly httpStatus = 404;
  readonly isRetryable = false;
  constructor(msg = 'test error') {
    super(msg);
  }
}

describe('Result<T>', () => {
  describe('ok()', () => {
    it('creates an OkResult', () => {
      const r = ok(42);
      expect(r).toBeInstanceOf(OkResult);
      expect(r.isOk()).toBe(true);
      expect(r.isErr()).toBe(false);
    });

    it('holds the value', () => {
      const r = ok({ price: 100 });
      expect((r as OkResult<{ price: number }, BaseError>).value).toEqual({ price: 100 });
    });
  });

  describe('err()', () => {
    it('creates an ErrResult', () => {
      const r = err(new TestError());
      expect(r).toBeInstanceOf(ErrResult);
      expect(r.isOk()).toBe(false);
      expect(r.isErr()).toBe(true);
    });

    it('holds the error', () => {
      const e = new TestError('specific');
      const r = err(e);
      expect((r as ErrResult<never, TestError>).error).toBe(e);
    });
  });

  describe('map()', () => {
    it('transforms Ok value', () => {
      const r = ok(5).map((v) => v * 2);
      expect(isOk(r)).toBe(true);
      expect((r as OkResult<number, BaseError>).value).toBe(10);
    });

    it('passes Err through unchanged', () => {
      const e = new TestError();
      const r = err<number>(e).map((v) => v * 2);
      expect(isErr(r)).toBe(true);
      expect((r as ErrResult<number, TestError>).error).toBe(e);
    });
  });

  describe('flatMap()', () => {
    it('chains Ok operations', () => {
      const r = ok(5).flatMap((v) => ok(v * 2));
      expect((r as OkResult<number, BaseError>).value).toBe(10);
    });

    it('short-circuits on first Err', () => {
      const e = new TestError();
      const r = err<number>(e).flatMap((v) => ok(v * 2));
      expect((r as ErrResult<number, TestError>).error).toBe(e);
    });

    it('propagates Err from chained operation', () => {
      const e = new TestError();
      const r = ok(5).flatMap<number>(() => err(e));
      expect((r as ErrResult<number, TestError>).error).toBe(e);
    });
  });

  describe('mapErr()', () => {
    it('transforms Err value', () => {
      const original = new TestError('original');
      const mapped = new DatabaseError('mapped');
      const r = err<number>(original).mapErr(() => mapped);
      expect((r as ErrResult<number, DatabaseError>).error).toBe(mapped);
    });

    it('passes Ok through unchanged', () => {
      const r = ok<number>(5).mapErr(() => new DatabaseError('should not run'));
      expect((r as OkResult<number, BaseError>).value).toBe(5);
    });
  });

  describe('match()', () => {
    it('calls onOk for OkResult', () => {
      const result = ok(42).match(
        (v) => `value: ${v}`,
        (_e) => 'error',
      );
      expect(result).toBe('value: 42');
    });

    it('calls onErr for ErrResult', () => {
      const result = err<number>(new TestError('oops')).match(
        (_v) => 'value',
        (e) => `error: ${e.message}`,
      );
      expect(result).toBe('error: oops');
    });
  });

  describe('getOrElse()', () => {
    it('returns value for Ok', () => {
      expect(ok(10).getOrElse(0)).toBe(10);
    });

    it('returns default for Err', () => {
      expect(err<number>(new TestError()).getOrElse(99)).toBe(99);
    });
  });

  describe('getOrThrow()', () => {
    it('returns value for Ok', () => {
      expect(ok('hello').getOrThrow()).toBe('hello');
    });

    it('throws error for Err', () => {
      const e = new TestError('thrown');
      expect(() => err(e).getOrThrow()).toThrow(e);
    });
  });

  describe('tap() / tapErr()', () => {
    it('tap calls fn on Ok without changing result', () => {
      const spy = jest.fn();
      const r = ok(1).tap(spy);
      expect(spy).toHaveBeenCalledWith(1);
      expect((r as OkResult<number, BaseError>).value).toBe(1);
    });

    it('tapErr calls fn on Err without changing result', () => {
      const spy = jest.fn();
      const e = new TestError();
      const r = err<number>(e).tapErr(spy);
      expect(spy).toHaveBeenCalledWith(e);
      expect((r as ErrResult<number, TestError>).error).toBe(e);
    });

    it('tap does not call fn on Err', () => {
      const spy = jest.fn();
      err<number>(new TestError()).tap(spy);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('isOk / isErr type guards', () => {
    it('isOk narrows to OkResult', () => {
      const r = ok(1) as OkResult<number, BaseError> | ErrResult<number, BaseError>;
      if (isOk(r)) {
        expect(r.value).toBe(1);
      } else {
        fail('should be ok');
      }
    });

    it('isErr narrows to ErrResult', () => {
      const e = new TestError();
      const r = err<number>(e) as OkResult<number, BaseError> | ErrResult<number, BaseError>;
      if (isErr(r)) {
        expect(r.error).toBe(e);
      } else {
        fail('should be err');
      }
    });
  });

  describe('fromPromise()', () => {
    it('wraps resolved promise in Ok', async () => {
      const r = await fromPromise(Promise.resolve(42), () => new TestError());
      expect(isOk(r)).toBe(true);
      expect((r as OkResult<number, BaseError>).value).toBe(42);
    });

    it('wraps rejected promise in Err', async () => {
      const e = new TestError('mapped');
      const r = await fromPromise(Promise.reject(new Error('raw')), () => e);
      expect(isErr(r)).toBe(true);
      expect((r as ErrResult<number, TestError>).error).toBe(e);
    });
  });

  describe('combineResults()', () => {
    it('returns Ok array when all results are Ok', () => {
      const results = [ok(1), ok(2), ok(3)];
      const r = combineResults(results);
      expect((r as OkResult<number[], BaseError>).value).toEqual([1, 2, 3]);
    });

    it('returns first Err when any result is Err', () => {
      const e = new TestError('first error');
      const results = [ok(1), err<number>(e), ok(3)];
      const r = combineResults(results);
      expect((r as ErrResult<number[], TestError>).error).toBe(e);
    });

    it('returns Ok for empty array', () => {
      const r = combineResults<number, TestError>([]);
      expect((r as OkResult<number[], BaseError>).value).toEqual([]);
    });
  });

  describe('Error hierarchy integration', () => {
    it('NotFoundError produces Err with correct code and status', () => {
      const e = new NotFoundError('Order', '123');
      const r = err<unknown>(e);
      expect((r as ErrResult<unknown, NotFoundError>).error.code).toBe(ErrorCode.DOMAIN_NOT_FOUND);
      expect((r as ErrResult<unknown, NotFoundError>).error.httpStatus).toBe(404);
      expect((r as ErrResult<unknown, NotFoundError>).error.isRetryable).toBe(false);
    });

    it('DatabaseError is retryable', () => {
      const e = new DatabaseError('connection refused');
      expect(e.isRetryable).toBe(true);
    });
  });
});
