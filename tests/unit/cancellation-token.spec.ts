import { CancellationToken } from '@common/resilience/cancellation-token';
import { OperationCancelledError } from '@common/errors/infrastructure.error';

describe('CancellationToken', () => {
  it('starts not cancelled', () => {
    const token = new CancellationToken();
    expect(token.isCancelled).toBe(false);
  });

  it('is cancelled after cancel() is called', () => {
    const token = new CancellationToken();
    token.cancel();
    expect(token.isCancelled).toBe(true);
  });

  it('throwIfCancelled() throws when cancelled', () => {
    const token = new CancellationToken();
    token.cancel();
    expect(() => token.throwIfCancelled()).toThrow(OperationCancelledError);
  });

  it('throwIfCancelled() is a no-op when not cancelled', () => {
    const token = new CancellationToken();
    expect(() => token.throwIfCancelled()).not.toThrow();
  });

  it('calls registered callbacks on cancel', () => {
    const token = new CancellationToken();
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    token.register(cb1);
    token.register(cb2);

    token.cancel();

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('calls callback immediately if already cancelled when registering', () => {
    const token = new CancellationToken();
    token.cancel();
    const cb = jest.fn();
    token.register(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unregister function removes callback', () => {
    const token = new CancellationToken();
    const cb = jest.fn();
    const unregister = token.register(cb);
    unregister();
    token.cancel();
    expect(cb).not.toHaveBeenCalled();
  });

  it('idempotent — calling cancel() twice does not call callbacks twice', () => {
    const token = new CancellationToken();
    const cb = jest.fn();
    token.register(cb);
    token.cancel();
    token.cancel();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('CancellationToken.NONE is never cancelled', () => {
    expect(CancellationToken.NONE.isCancelled).toBe(false);
    CancellationToken.NONE.cancel();
    expect(CancellationToken.NONE.isCancelled).toBe(false);
  });

  it('callback errors do not propagate to cancel caller', () => {
    const token = new CancellationToken();
    token.register(() => {
      throw new Error('callback error');
    });
    expect(() => token.cancel()).not.toThrow();
  });
});
