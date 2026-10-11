import { WsReconnectManager } from '@common/websocket/reconnect/ws-reconnect-manager';

jest.useFakeTimers();

describe('WsReconnectManager', () => {
  function make(
    opts?: Partial<ConstructorParameters<typeof WsReconnectManager>[0]>,
  ): WsReconnectManager {
    return new WsReconnectManager({
      baseDelayMs: 100,
      maxDelayMs: 2000,
      maxAttempts: 5,
      stableThresholdMs: 1000,
      ...opts,
    });
  }

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('scheduleReconnect', () => {
    it('returns a delay object and schedules the callback', () => {
      const mgr = make();
      const cb = jest.fn();
      const result = mgr.scheduleReconnect(cb);
      expect(result).not.toBeNull();
      expect(result!.delayMs).toBeGreaterThanOrEqual(0);
      jest.runAllTimers();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('increments currentAttempt on each call', () => {
      const mgr = make();
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      expect(mgr.currentAttempt).toBe(2);
    });

    it('returns null when maxAttempts is exceeded', () => {
      const mgr = make({ maxAttempts: 2 });
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      expect(mgr.scheduleReconnect(jest.fn())).toBeNull();
    });

    it('retries indefinitely when maxAttempts === -1', () => {
      const mgr = make({ maxAttempts: -1 });
      for (let i = 0; i < 20; i++) {
        const r = mgr.scheduleReconnect(jest.fn());
        jest.runAllTimers();
        expect(r).not.toBeNull();
      }
    });

    it('hasPending is true while timer is active', () => {
      const mgr = make();
      mgr.scheduleReconnect(jest.fn());
      expect(mgr.hasPending).toBe(true);
      jest.runAllTimers();
      expect(mgr.hasPending).toBe(false);
    });
  });

  describe('cancel', () => {
    it('prevents the callback from being called', () => {
      const mgr = make();
      const cb = jest.fn();
      mgr.scheduleReconnect(cb);
      mgr.cancel();
      jest.runAllTimers();
      expect(cb).not.toHaveBeenCalled();
    });

    it('sets hasPending to false', () => {
      const mgr = make();
      mgr.scheduleReconnect(jest.fn());
      mgr.cancel();
      expect(mgr.hasPending).toBe(false);
    });
  });

  describe('checkStability', () => {
    it('resets attempt counter after connected for stableThresholdMs', () => {
      const mgr = make({ stableThresholdMs: 500 });
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      expect(mgr.currentAttempt).toBe(2);

      mgr.onConnected();
      jest.advanceTimersByTime(501);
      mgr.checkStability();
      expect(mgr.currentAttempt).toBe(0);
    });

    it('does not reset before stableThresholdMs elapses', () => {
      const mgr = make({ stableThresholdMs: 1000 });
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      mgr.onConnected();
      jest.advanceTimersByTime(100);
      mgr.checkStability();
      expect(mgr.currentAttempt).toBe(1);
    });
  });

  describe('totalReconnectCount', () => {
    it('counts across stability resets', () => {
      const mgr = make({ stableThresholdMs: 0 });
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      mgr.onConnected();
      mgr.checkStability();
      mgr.scheduleReconnect(jest.fn());
      jest.runAllTimers();
      expect(mgr.totalReconnectCount).toBe(2);
    });
  });
});
