import { WsHeartbeatMonitor } from '@common/websocket/heartbeat/ws-heartbeat-monitor';

jest.useFakeTimers();

describe('WsHeartbeatMonitor', () => {
  let monitor: WsHeartbeatMonitor;

  beforeEach(() => {
    // timeoutMs intentionally large so basic ping tests don't hit the timeout path
    monitor = new WsHeartbeatMonitor({ intervalMs: 100, timeoutMs: 60_000, threshold: 2 });
  });

  afterEach(() => {
    monitor.stop();
    jest.clearAllTimers();
  });

  describe('start', () => {
    it('calls sendPing on each interval tick', () => {
      const sendPing = jest.fn();
      monitor.start(sendPing, jest.fn());
      jest.advanceTimersByTime(100);
      expect(sendPing).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(100);
      expect(sendPing).toHaveBeenCalledTimes(2);
    });

    it('is idempotent — second start() is a no-op', () => {
      const sendPing = jest.fn();
      monitor.start(sendPing, jest.fn());
      monitor.start(sendPing, jest.fn());
      jest.advanceTimersByTime(100);
      expect(sendPing).toHaveBeenCalledTimes(1);
    });

    it('isRunning is true after start', () => {
      monitor.start(jest.fn(), jest.fn());
      expect(monitor.isRunning).toBe(true);
    });
  });

  describe('heartbeat timeout', () => {
    // Use a monitor where timeoutMs < intervalMs so every tick is a missed heartbeat
    function makeTimeoutMonitor(): WsHeartbeatMonitor {
      return new WsHeartbeatMonitor({ intervalMs: 100, timeoutMs: 50, threshold: 2 });
    }

    it('calls onTimeout after threshold missed heartbeats', () => {
      const onTimeout = jest.fn();
      const m = makeTimeoutMonitor();
      m.start(jest.fn(), onTimeout);

      // First tick at 100ms: missed=1 (100 > 50ms timeout), sendPing
      jest.advanceTimersByTime(100);
      expect(onTimeout).not.toHaveBeenCalled();

      // Second tick at 200ms: missed=2 → onTimeout fires, no sendPing
      jest.advanceTimersByTime(100);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      m.stop();
    });

    it('stops the interval after calling onTimeout', () => {
      const sendPing = jest.fn();
      const onTimeout = jest.fn();
      const m = makeTimeoutMonitor();
      m.start(sendPing, onTimeout);

      jest.advanceTimersByTime(100); // tick 1: missed=1, sendPing
      jest.advanceTimersByTime(100); // tick 2: missed=2, onTimeout (no sendPing)
      const callsAtTimeout = sendPing.mock.calls.length; // should be 1

      jest.advanceTimersByTime(500); // interval is stopped, no more pings
      expect(sendPing).toHaveBeenCalledTimes(callsAtTimeout);
      m.stop();
    });
  });

  describe('recordPong', () => {
    it('resets missed count and prevents timeout', () => {
      const onTimeout = jest.fn();
      const m = new WsHeartbeatMonitor({ intervalMs: 100, timeoutMs: 50, threshold: 2 });
      m.start(jest.fn(), onTimeout);

      jest.advanceTimersByTime(100); // tick 1: missed=1
      m.recordPong(); // reset: missed=0, lastPongAt refreshed
      jest.advanceTimersByTime(100); // tick 2: only 1 missed since pong → no timeout
      // onTimeout NOT fired — pong reset the streak
      expect(onTimeout).not.toHaveBeenCalled();
      m.stop();
    });

    it('missedHeartbeats is 0 after recordPong', () => {
      const m = new WsHeartbeatMonitor({ intervalMs: 100, timeoutMs: 50, threshold: 5 });
      m.start(jest.fn(), jest.fn());
      jest.advanceTimersByTime(100); // missed becomes 1
      m.recordPong();
      expect(m.missedHeartbeats).toBe(0);
      m.stop();
    });
  });

  describe('stop', () => {
    it('stops the interval', () => {
      const sendPing = jest.fn();
      monitor.start(sendPing, jest.fn());
      monitor.stop();
      jest.advanceTimersByTime(500);
      expect(sendPing).not.toHaveBeenCalled();
    });

    it('sets isRunning to false', () => {
      monitor.start(jest.fn(), jest.fn());
      monitor.stop();
      expect(monitor.isRunning).toBe(false);
    });
  });

  describe('reset', () => {
    it('stops the timer and clears pong state', () => {
      monitor.start(jest.fn(), jest.fn());
      monitor.recordPong();
      monitor.reset();
      expect(monitor.isRunning).toBe(false);
      expect(monitor.missedHeartbeats).toBe(0);
      expect(monitor.msSinceLastPong).toBe(Infinity);
    });
  });

  describe('msSinceLastPong', () => {
    it('returns Infinity before start', () => {
      expect(monitor.msSinceLastPong).toBe(Infinity);
    });

    it('returns elapsed ms after start', () => {
      monitor.start(jest.fn(), jest.fn());
      jest.advanceTimersByTime(30);
      expect(monitor.msSinceLastPong).toBeGreaterThanOrEqual(30);
    });
  });
});
