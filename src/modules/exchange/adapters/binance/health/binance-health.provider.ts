import { Injectable } from '@nestjs/common';
import {
  NamedHealthCheck,
  ProviderHealth,
  healthyResult,
  degradedResult,
  unhealthyResult,
} from '@infrastructure/health/health-check.interface';
import { BinanceRateLimitManager } from '../rate-limit/binance-rate-limit.manager';
import { BinanceServerTimeService } from '../server-time/binance-server-time.service';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { BINANCE_RATE_LIMITS } from '../config/binance.constants';

@Injectable()
export class BinanceHealthProvider implements NamedHealthCheck {
  readonly name = 'binance-spot';

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly rateLimitManager: BinanceRateLimitManager,
    private readonly serverTimeService: BinanceServerTimeService,
  ) {}

  async check(): Promise<ProviderHealth> {
    const metadata: Record<string, unknown> = {};

    const isRegistered = this.registry.has(ExchangeId.BINANCE_SPOT);
    metadata['registered'] = isRegistered;

    if (!isRegistered) {
      return unhealthyResult('Adapter not registered');
    }

    const isInstantiated = this.registry.isInstantiated(ExchangeId.BINANCE_SPOT);
    metadata['instantiated'] = isInstantiated;

    if (!isInstantiated) {
      return degradedResult('Adapter registered but not yet initialized');
    }

    const adapter = this.registry.create(ExchangeId.BINANCE_SPOT);
    metadata['connected'] = adapter.isConnected();

    if (!adapter.isConnected()) {
      return unhealthyResult('Adapter not connected');
    }

    const rateLimitStatus = this.rateLimitManager.getStatus();
    const requestWeightStatus = rateLimitStatus.find((s) => s.category === 'request');
    if (requestWeightStatus) {
      const usagePercent =
        (requestWeightStatus.used / BINANCE_RATE_LIMITS.REQUEST_WEIGHT_PER_MINUTE) * 100;
      metadata['rateLimitUsagePercent'] = Math.round(usagePercent);
      metadata['rateLimitUsed'] = requestWeightStatus.used;
      metadata['rateLimitRemaining'] = requestWeightStatus.remaining;

      if (usagePercent > 90) {
        return {
          ...degradedResult(`Rate limit usage critical: ${Math.round(usagePercent)}%`),
          metadata,
        };
      }
    }

    metadata['serverTimeSynchronized'] = this.serverTimeService.isSynchronized;
    metadata['serverTimeOffsetMs'] = this.serverTimeService.currentOffsetMs;
    metadata['lastTimeSyncAt'] = this.serverTimeService.lastSynchronizedAt?.toISOString() ?? null;

    return { ...healthyResult('Binance Spot healthy'), metadata };
  }
}
