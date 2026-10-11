import { WsMetricsCollector } from '@common/websocket/metrics/ws-metrics-collector';
import { WsConnectionState } from '@common/websocket/enums/ws-connection-state.enum';

describe('WsMetricsCollector', () => {
  let collector: WsMetricsCollector;

  beforeEach(() => {
    collector = new WsMetricsCollector();
  });

  describe('initial state', () => {
    it('returns zero counters and DISCONNECTED state', () => {
      const metrics = collector.getMetrics(0);
      expect(metrics.state).toBe(WsConnectionState.DISCONNECTED);
      expect(metrics.totalMessagesReceived).toBe(0);
      expect(metrics.totalBytesReceived).toBe(0);
      expect(metrics.totalErrors).toBe(0);
      expect(metrics.reconnectCount).toBe(0);
      expect(metrics.connectedAt).toBeNull();
    });
  });

  describe('onStateChange', () => {
    it('sets state', () => {
      collector.onStateChange(WsConnectionState.CONNECTED);
      expect(collector.getMetrics(0).state).toBe(WsConnectionState.CONNECTED);
    });

    it('sets connectedAt when entering CONNECTED', () => {
      const before = new Date();
      collector.onStateChange(WsConnectionState.CONNECTED);
      const after = new Date();
      const { connectedAt } = collector.getMetrics(0);
      expect(connectedAt).not.toBeNull();
      expect(connectedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(connectedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('clears connectedAt when leaving CONNECTED', () => {
      collector.onStateChange(WsConnectionState.CONNECTED);
      collector.onStateChange(WsConnectionState.RECONNECTING);
      expect(collector.getMetrics(0).connectedAt).toBeNull();
    });
  });

  describe('recordMessage', () => {
    it('increments totalMessagesReceived and totalBytesReceived', () => {
      collector.recordMessage(100);
      collector.recordMessage(200);
      const metrics = collector.getMetrics(0);
      expect(metrics.totalMessagesReceived).toBe(2);
      expect(metrics.totalBytesReceived).toBe(300);
    });
  });

  describe('recordError', () => {
    it('increments totalErrors', () => {
      collector.recordError();
      collector.recordError();
      expect(collector.getMetrics(0).totalErrors).toBe(2);
    });
  });

  describe('recordReconnect', () => {
    it('increments reconnectCount', () => {
      collector.recordReconnect();
      expect(collector.getMetrics(0).reconnectCount).toBe(1);
    });
  });

  describe('messagesPerSecond (sliding window)', () => {
    it('returns 0 when no messages in the last second', () => {
      // Record a message, then fake it as if it happened 2 seconds ago
      // by manually triggering pruning via another message after window
      expect(collector.getMetrics(0).messagesPerSecond).toBe(0);
    });

    it('counts messages within the last second', () => {
      collector.recordMessage(50);
      collector.recordMessage(50);
      collector.recordMessage(50);
      expect(collector.getMetrics(0).messagesPerSecond).toBe(3);
    });
  });

  describe('getMetrics subscriptionCount', () => {
    it('forwards the subscriptionCount arg into the result', () => {
      expect(collector.getMetrics(42).subscriptionCount).toBe(42);
    });
  });

  describe('uptimeMs', () => {
    it('is 0 when not connected', () => {
      expect(collector.getMetrics(0).uptimeMs).toBe(0);
    });

    it('is positive when in CONNECTED state', async () => {
      collector.onStateChange(WsConnectionState.CONNECTED);
      await new Promise((r) => setTimeout(r, 5));
      expect(collector.getMetrics(0).uptimeMs).toBeGreaterThan(0);
    });
  });
});
