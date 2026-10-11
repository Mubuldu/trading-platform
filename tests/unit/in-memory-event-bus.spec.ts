import { DomainEvent } from '@domain/base/domain-event';
import { InMemoryEventBusProvider } from '@infrastructure/providers/event-bus/in-memory-event-bus.provider';
import { AppLoggerService } from '@core/logging/app-logger.service';

class OrderPlacedEvent extends DomainEvent {
  readonly eventType = 'OrderPlaced';
  readonly aggregateId: string;
  readonly aggregateVersion = 1;
  readonly symbol: string;

  constructor(orderId: string, symbol: string) {
    super();
    this.aggregateId = orderId;
    this.symbol = symbol;
  }
}

function makeLogger(): AppLoggerService {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    info: jest.fn(),
    critical: jest.fn(),
    fatal: jest.fn(),
  } as unknown as AppLoggerService;
}

describe('InMemoryEventBusProvider', () => {
  let bus: InMemoryEventBusProvider;

  beforeEach(() => {
    bus = new InMemoryEventBusProvider(makeLogger());
  });

  describe('publish()', () => {
    it('delivers event to subscribed handler', async () => {
      const received: OrderPlacedEvent[] = [];
      bus.subscribe<OrderPlacedEvent>('OrderPlaced', async (e) => {
        received.push(e);
      });

      const event = new OrderPlacedEvent('o1', 'BTC/USDT');
      await bus.publish(event);

      expect(received).toHaveLength(1);
      expect(received[0].symbol).toBe('BTC/USDT');
    });

    it('delivers to multiple handlers', async () => {
      const calls: number[] = [];
      bus.subscribe('OrderPlaced', async () => {
        calls.push(1);
      });
      bus.subscribe('OrderPlaced', async () => {
        calls.push(2);
      });

      await bus.publish(new OrderPlacedEvent('o1', 'BTC'));
      expect(calls).toHaveLength(2);
    });

    it('does not deliver to handlers of other event types', async () => {
      const spy = jest.fn();
      bus.subscribe('RiskChecked', spy);
      await bus.publish(new OrderPlacedEvent('o1', 'BTC'));
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns Ok even when no handlers are registered', async () => {
      const r = await bus.publish(new OrderPlacedEvent('o1', 'BTC'));
      expect(r.isOk()).toBe(true);
    });

    it('does not rethrow handler errors', async () => {
      bus.subscribe('OrderPlaced', async () => {
        throw new Error('handler crash');
      });
      await expect(bus.publish(new OrderPlacedEvent('o1', 'BTC'))).resolves.not.toThrow();
    });
  });

  describe('publishBatch()', () => {
    it('publishes all events in order', async () => {
      const received: string[] = [];
      bus.subscribe<OrderPlacedEvent>('OrderPlaced', async (e) => {
        received.push(e.aggregateId);
      });

      await bus.publishBatch([
        new OrderPlacedEvent('o1', 'BTC'),
        new OrderPlacedEvent('o2', 'ETH'),
      ]);

      expect(received).toEqual(['o1', 'o2']);
    });
  });

  describe('subscribe() / unsubscribe()', () => {
    it('returns a subscription with unsubscribe()', () => {
      const sub = bus.subscribe('OrderPlaced', async () => {});
      expect(sub.eventType).toBe('OrderPlaced');
      expect(typeof sub.subscriptionId).toBe('string');
      expect(typeof sub.unsubscribe).toBe('function');
    });

    it('stops delivery after unsubscribe()', async () => {
      const spy = jest.fn();
      const sub = bus.subscribe('OrderPlaced', spy);
      sub.unsubscribe();

      await bus.publish(new OrderPlacedEvent('o1', 'BTC'));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getHealth()', () => {
    it('reports healthy status', async () => {
      const h = await bus.getHealth();
      expect(h.status).toBe('healthy');
    });
  });
});
