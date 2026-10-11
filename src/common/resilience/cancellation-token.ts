import { OperationCancelledError } from '@common/errors/infrastructure.error';

/**
 * CancellationToken provides cooperative cancellation for long-running and
 * async operations without relying on Promise rejection or AbortController.
 *
 * Usage pattern:
 *   const token = new CancellationToken();
 *   runSomeOperation(token);
 *   token.cancel(); // signals the operation to stop
 *
 * Consumers check token.isCancelled or call token.throwIfCancelled() at
 * checkpoints inside their async loops.
 *
 * CancellationToken.NONE is a sentinel that never fires — use it as the
 * default parameter when cancellation is optional.
 *
 * Callbacks registered via register() are invoked synchronously on cancel().
 * This allows cleanup logic (clearing timers, closing connections) without
 * the complexity of Promise rejection chains.
 */
export class CancellationToken {
  private _isCancelled = false;
  private readonly _callbacks: Set<() => void> = new Set();

  static readonly NONE: CancellationToken =
    new (class NeverCancelledToken extends CancellationToken {
      override cancel(): void {
        // NONE is immutable — cancel is a no-op
      }
    })();

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new OperationCancelledError();
    }
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const cb of this._callbacks) {
      try {
        cb();
      } catch {
        // callbacks must never propagate errors back to the canceller
      }
    }
    this._callbacks.clear();
  }

  /**
   * Registers a cleanup callback to run when this token is cancelled.
   * Returns an unregister function to remove the callback if no longer needed.
   */
  register(callback: () => void): () => void {
    if (this._isCancelled) {
      callback();
      return (): void => {};
    }
    this._callbacks.add(callback);
    return (): void => {
      this._callbacks.delete(callback);
    };
  }
}
