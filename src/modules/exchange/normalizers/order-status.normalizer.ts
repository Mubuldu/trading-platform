import { OrderStatus } from '../enums/order.enums';
import { ExchangeId } from '../enums/exchange.enums';

/**
 * OrderStatusNormalizer translates exchange-specific order status strings
 * into the platform's canonical OrderStatus enum.
 *
 * Why a registry pattern: each exchange uses different status strings with
 * overlapping but distinct semantics (e.g. Bybit's "PartiallyFilled" vs
 * Binance's "PARTIALLY_FILLED"). Future adapters register their own status
 * mappings at initialization without modifying this file.
 *
 * If an unknown status is encountered, UNKNOWN is returned and a warning
 * should be logged. The adapter should not crash on an unknown status —
 * exchanges occasionally add new interim statuses in API updates.
 *
 * Mappings are registered by exchange adapters via registerMappings().
 * The paper trading adapter registers mappings identical to the enum values.
 */
export class OrderStatusNormalizer {
  private readonly registry = new Map<ExchangeId, Map<string, OrderStatus>>();

  registerMappings(exchangeId: ExchangeId, mappings: Record<string, OrderStatus>): void {
    const normalized = new Map<string, OrderStatus>();
    for (const [raw, status] of Object.entries(mappings)) {
      normalized.set(raw.toUpperCase(), status);
    }
    this.registry.set(exchangeId, normalized);
  }

  normalize(rawStatus: string, exchangeId: ExchangeId): OrderStatus {
    const exchangeMap = this.registry.get(exchangeId);
    if (!exchangeMap) {
      return this.fallbackNormalize(rawStatus);
    }

    const normalized = exchangeMap.get(rawStatus.toUpperCase());
    if (!normalized) {
      return this.fallbackNormalize(rawStatus);
    }

    return normalized;
  }

  hasMapping(exchangeId: ExchangeId): boolean {
    return this.registry.has(exchangeId);
  }

  /**
   * Fallback attempts to normalize by matching against the canonical enum
   * values directly (case-insensitive). Works for exchanges that already
   * use the same terminology as our enum.
   *
   * If the status cannot be matched, UNKNOWN is returned. Callers must log
   * a warning and treat the order state as indeterminate — never assume
   * an unrecognised status means NEW or FILLED.
   */
  private fallbackNormalize(rawStatus: string): OrderStatus {
    const upper = rawStatus.toUpperCase().replace(/\s+/g, '_');
    const directMatch = Object.values(OrderStatus).find((v) => v === upper);
    return directMatch ?? OrderStatus.UNKNOWN;
  }
}
