import { WsSubscriptionManager } from '@common/websocket/subscription/ws-subscription-manager';
import { WsMessageHandler, WsMessageMeta } from '@common/websocket/types/ws-message.types';

function makeMeta(streamId = 'test'): WsMessageMeta {
  return { streamId, receivedAt: new Date(), processingLatencyMs: 0 };
}

describe('WsSubscriptionManager', () => {
  let mgr: WsSubscriptionManager;

  beforeEach(() => {
    mgr = new WsSubscriptionManager(10);
  });

  describe('subscribe', () => {
    it('returns subscriptionId and isNewStream=true for first subscriber', () => {
      const handler: WsMessageHandler = jest.fn();
      const result = mgr.subscribe('stream-a', handler);
      expect(result).not.toBeNull();
      expect(result!.isNewStream).toBe(true);
      expect(typeof result!.subscriptionId).toBe('string');
    });

    it('returns same subscriptionId and isNewStream=false for second subscriber on same stream', () => {
      const h1: WsMessageHandler = jest.fn();
      const h2: WsMessageHandler = jest.fn();
      const r1 = mgr.subscribe('stream-a', h1);
      const r2 = mgr.subscribe('stream-a', h2);
      expect(r2!.isNewStream).toBe(false);
      expect(r2!.subscriptionId).toBe(r1!.subscriptionId);
    });

    it('adding the same handler twice is idempotent (Set semantics)', () => {
      const h: WsMessageHandler = jest.fn();
      mgr.subscribe('stream-a', h);
      mgr.subscribe('stream-a', h);
      expect(mgr.handlerCount).toBe(1);
    });

    it('returns null when maxStreams is reached', () => {
      const tiny = new WsSubscriptionManager(1);
      tiny.subscribe('a', jest.fn());
      expect(tiny.subscribe('b', jest.fn())).toBeNull();
    });
  });

  describe('unsubscribe', () => {
    it('removes a specific handler; stream persists if others remain', () => {
      const h1: WsMessageHandler = jest.fn();
      const h2: WsMessageHandler = jest.fn();
      mgr.subscribe('s', h1);
      mgr.subscribe('s', h2);
      const result = mgr.unsubscribe('s', h1);
      expect(result.removed).toBe(true);
      expect(result.streamRemoved).toBe(false);
      expect(mgr.hasStream('s')).toBe(true);
    });

    it('removes the stream record when the last handler is removed', () => {
      const h: WsMessageHandler = jest.fn();
      mgr.subscribe('s', h);
      const result = mgr.unsubscribe('s', h);
      expect(result.removed).toBe(true);
      expect(result.streamRemoved).toBe(true);
      expect(mgr.hasStream('s')).toBe(false);
    });

    it('returns removed=false for unknown stream', () => {
      const result = mgr.unsubscribe('nope', jest.fn());
      expect(result.removed).toBe(false);
      expect(result.streamRemoved).toBe(false);
    });
  });

  describe('unsubscribeStream', () => {
    it('removes stream with all handlers', () => {
      mgr.subscribe('s', jest.fn());
      mgr.subscribe('s', jest.fn());
      expect(mgr.unsubscribeStream('s')).toBe(true);
      expect(mgr.hasStream('s')).toBe(false);
    });

    it('returns false for unknown stream', () => {
      expect(mgr.unsubscribeStream('nope')).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('calls all registered handlers for a stream', () => {
      const h1: WsMessageHandler<string> = jest.fn();
      const h2: WsMessageHandler<string> = jest.fn();
      mgr.subscribe('s', h1 as WsMessageHandler);
      mgr.subscribe('s', h2 as WsMessageHandler);
      mgr.dispatch('s', 'payload', makeMeta('s'));
      expect(h1).toHaveBeenCalledWith('payload', expect.objectContaining({ streamId: 's' }));
      expect(h2).toHaveBeenCalledWith('payload', expect.objectContaining({ streamId: 's' }));
    });

    it('does not crash if a handler throws', () => {
      const throwing: WsMessageHandler = jest.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      const normal: WsMessageHandler = jest.fn();
      mgr.subscribe('s', throwing);
      mgr.subscribe('s', normal);
      expect(() => mgr.dispatch('s', {}, makeMeta())).not.toThrow();
      expect(normal).toHaveBeenCalled();
    });

    it('is a no-op for an unknown stream', () => {
      expect(() => mgr.dispatch('unknown', {}, makeMeta())).not.toThrow();
    });
  });

  describe('metrics', () => {
    it('streamCount reflects active streams', () => {
      mgr.subscribe('a', jest.fn());
      mgr.subscribe('b', jest.fn());
      expect(mgr.streamCount).toBe(2);
    });

    it('handlerCount sums all handlers across streams', () => {
      mgr.subscribe('a', jest.fn());
      mgr.subscribe('a', jest.fn());
      mgr.subscribe('b', jest.fn());
      expect(mgr.handlerCount).toBe(3);
    });

    it('getStreamIds returns all active stream IDs', () => {
      mgr.subscribe('x', jest.fn());
      mgr.subscribe('y', jest.fn());
      expect(mgr.getStreamIds()).toEqual(expect.arrayContaining(['x', 'y']));
    });
  });

  describe('destroy', () => {
    it('clears all subscriptions', () => {
      mgr.subscribe('a', jest.fn());
      mgr.subscribe('b', jest.fn());
      mgr.destroy();
      expect(mgr.streamCount).toBe(0);
      expect(mgr.handlerCount).toBe(0);
    });
  });
});
