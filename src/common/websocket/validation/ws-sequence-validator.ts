/** Per-stream sequence tracking state. */
interface SequenceState {
  lastId: number;
  gapCount: number;
  dupCount: number;
}

export type SequenceValidationResult =
  | 'ok' // in-order, no gap
  | 'initialized' // first message seen for this stream
  | 'duplicate' // updateId already processed — skip silently
  | 'gap' // missed updates — warn but continue
  | 'resync'; // too many gaps — trigger snapshot re-fetch

/**
 * WsSequenceValidator tracks per-stream update IDs to detect:
 *  - Duplicates:   updateId ≤ lastId
 *  - Gaps:         firstId > lastId + 1
 *  - Out-of-order: subset of gaps
 *
 * When gapCount reaches maxGapsBeforeResync the stream state is cleared and
 * 'resync' is returned, signaling the caller to re-fetch a snapshot.
 *
 * Call reset(streamId) on reconnect — new connections start a new sequence.
 */
export class WsSequenceValidator {
  private readonly states = new Map<string, SequenceState>();
  private readonly maxGapsBeforeResync: number;

  constructor(maxGapsBeforeResync = 3) {
    this.maxGapsBeforeResync = maxGapsBeforeResync;
  }

  /**
   * Validate an incoming update.
   *
   * @param streamId   The stream identifier (e.g. "btcusdt@depth").
   * @param updateId   The last/current update ID in this message.
   * @param firstId    For streams with a batch range (e.g. Binance depth U field).
   *                   If firstId > lastId + 1 there is a gap.
   */
  validate(streamId: string, updateId: number, firstId?: number): SequenceValidationResult {
    const state = this.states.get(streamId);

    if (!state) {
      this.states.set(streamId, { lastId: updateId, gapCount: 0, dupCount: 0 });
      return 'initialized';
    }

    // Duplicate — already seen this or older message
    if (updateId <= state.lastId) {
      state.dupCount++;
      return 'duplicate';
    }

    // Gap check: the first update ID in this batch should equal lastId + 1
    const expectedNext = state.lastId + 1;
    const effectiveFirst = firstId !== undefined ? firstId : updateId;

    if (effectiveFirst > expectedNext) {
      state.gapCount++;
      state.lastId = updateId;

      if (state.gapCount >= this.maxGapsBeforeResync) {
        // Clear state — next message will be treated as 'initialized'
        this.states.delete(streamId);
        return 'resync';
      }

      return 'gap';
    }

    // In-order — clear gap streak
    state.gapCount = 0;
    state.lastId = updateId;
    return 'ok';
  }

  /** Reset sequence state for a stream (call on reconnect). */
  reset(streamId: string): void {
    this.states.delete(streamId);
  }

  /** Reset all streams (call when the connection is re-established). */
  resetAll(): void {
    this.states.clear();
  }

  /** Diagnostic stats for a stream, or null if not yet seen. */
  getStats(streamId: string): Readonly<SequenceState> | null {
    const s = this.states.get(streamId);
    return s ? { ...s } : null;
  }
}
