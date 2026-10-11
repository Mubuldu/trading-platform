import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';
import { FundingRate } from '@modules/exchange/models/market.models';
import { PaperPositionManagerService } from './paper-position-manager.service';
import { PaperAccountService } from './paper-account.service';

/**
 * PaperFundingService simulates perpetual futures funding payments.
 *
 * Funding is applied at the configured interval (default 8h) or whenever a
 * FundingRate event is received from the MarketDataEventBus.
 *
 * Payment formula (standard perpetual):
 *   payment = positionSize × markPrice × fundingRate
 *
 * Positive rate: longs pay shorts.
 * Negative rate: shorts pay longs.
 *
 * When PAPER_TRADING_FUNDING_ENABLED=false (default), this service is a no-op.
 * Funding is optional because many strategies ignore it in early testing, and
 * the risk of misconfiguring it outweighs its value at that stage.
 */
@Injectable()
export class PaperFundingService implements OnModuleInit, OnModuleDestroy {
  private readonly context = PaperFundingService.name;
  private readonly cfg: PaperTradingConfig;

  /** Latest funding rate per symbol. Updated on every FundingRate event. */
  private readonly latestRates = new Map<string, number>();

  /** Periodic funding application timer. */
  private fundingTimer: ReturnType<typeof setInterval> | null = null;

  private readonly fundingRateHandler: (rate: FundingRate) => void;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly marketDataBus: MarketDataEventBus,
    private readonly positionManager: PaperPositionManagerService,
    private readonly account: PaperAccountService,
  ) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
    this.fundingRateHandler = (rate: FundingRate): void => {
      if (rate.rate !== undefined) this.latestRates.set(rate.symbol, rate.rate);
    };
  }

  onModuleInit(): void {
    if (!this.cfg.enabled || !this.cfg.fundingEnabled) {
      this.logger.log('Paper funding simulation is DISABLED', this.context);
      return;
    }

    this.marketDataBus.on(MARKET_DATA_EVENTS.FUNDING_RATE_UPDATED, this.fundingRateHandler);

    this.fundingTimer = setInterval(() => void this.applyFunding(), this.cfg.fundingIntervalMs);

    this.logger.log(
      `Paper funding initialized — interval=${this.cfg.fundingIntervalMs}ms`,
      this.context,
    );
  }

  onModuleDestroy(): void {
    if (this.fundingTimer) clearInterval(this.fundingTimer);
    this.marketDataBus.off(MARKET_DATA_EVENTS.FUNDING_RATE_UPDATED, this.fundingRateHandler);
  }

  // ── Funding application ──────────────────────────────────────────────────────

  private async applyFunding(): Promise<void> {
    const openPositions = this.positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    let totalFundingPayment = 0;

    for (const pos of openPositions) {
      const rate = this.latestRates.get(pos.symbol);
      if (rate === undefined || rate === 0) continue;

      const notional = pos.quantity * pos.averageEntryPrice;
      // Positive rate: long pays, short receives. Negative: opposite.
      const payment = notional * rate * (pos.direction === 'LONG' ? 1 : -1);
      totalFundingPayment += payment;

      this.logger.debug(
        `Paper funding: ${pos.symbol} ${pos.direction} notional=${notional.toFixed(2)} rate=${rate} payment=${payment.toFixed(4)}`,
        this.context,
      );
    }

    if (totalFundingPayment !== 0) {
      this.account.applyFunding(totalFundingPayment);
      this.logger.log(
        `Paper funding applied: total=${totalFundingPayment.toFixed(4)} USDT`,
        this.context,
      );
    }
  }

  /** Returns the latest known funding rate for a symbol, or null if unknown. */
  getLatestRate(symbol: string): number | null {
    return this.latestRates.get(symbol) ?? null;
  }
}
