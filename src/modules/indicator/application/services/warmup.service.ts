import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { IndicatorConfig } from '@config/indicator.config';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { Candle } from '../../domain/models/candle.model';
import { Timeframe, TIMEFRAME_TO_STREAM } from '../../domain/enums/timeframe.enum';
import { IIndicatorCalculator } from '../../interfaces/indicator-calculator.interface';
import { IndicatorRegistryService } from '../../infrastructure/registry/indicator-registry.service';
import { CandleValidatorService } from '../../infrastructure/validators/candle-validator.service';

type KlineEntry = {
  openTime: number;
  closeTime: number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  isClosed: boolean;
};

@Injectable()
export class WarmupService {
  private readonly context = WarmupService.name;
  private readonly warmupTimeoutMs: number;
  /** Most recent closed candle per `${symbol}:${timeframe}` seen during warmup. */
  private readonly lastCandleByKey = new Map<string, Candle>();

  constructor(
    private readonly registry: IndicatorRegistryService,
    private readonly validator: CandleValidatorService,
    private readonly redisClient: RedisClientService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.warmupTimeoutMs = this.configService.get<IndicatorConfig>('indicator')!.warmupTimeoutMs;
  }

  /**
   * Returns the last known candle for each symbol+timeframe processed during warmup.
   * Used by IndicatorOrchestratorService to seed strategy state immediately after boot
   * rather than waiting for the first live closed candle.
   */
  getLastCandles(): Candle[] {
    return [...this.lastCandleByKey.values()];
  }

  async warmupAll(): Promise<void> {
    const calculators = this.registry.getAll();
    if (calculators.length === 0) return;

    this.logger.log(`Starting warmup for ${calculators.length} indicators`, this.context);

    const byTimeframe = this.groupByTimeframe(calculators);

    await Promise.race([this.doWarmup(byTimeframe), this.timeoutReject()]);

    const status = this.registry.getWarmupStatus();
    this.logger.log(
      `Warmup complete: ${status.warmedUp}/${status.total} indicators ready`,
      this.context,
    );
    if (status.pending.length > 0) {
      this.logger.warn(
        `Indicators not warmed up (insufficient history): ${status.pending.join(', ')}`,
        this.context,
      );
    }
  }

  private async doWarmup(byTimeframe: Map<Timeframe, IIndicatorCalculator[]>): Promise<void> {
    for (const [timeframe, calculators] of byTimeframe) {
      const maxWarmup = Math.max(...calculators.map((c) => c.getWarmupRequired()));
      const historicalCandles = await this.fetchHistoricalCandles(timeframe, maxWarmup);

      if (historicalCandles.length === 0) {
        this.logger.warn(
          `No historical candles available for timeframe ${timeframe}`,
          this.context,
        );
        continue;
      }

      const validCandles = this.filterValidCandles(historicalCandles, timeframe);

      // Pre-bucket candles by symbol so each calculator only receives candles
      // for its own symbol. Without this, a multi-symbol warmup feeds BTC candles
      // to the ETH EMA-200 (and vice-versa), producing wildly wrong starting values
      // (e.g. ETH EMA-200 ≈ $12 762 when ETH is at $2 467 because the EMA decays
      // from the preceding BTC-price series over 200 candles).
      const candlesBySymbol = new Map<string, Candle[]>();
      for (const candle of validCandles) {
        if (!candlesBySymbol.has(candle.symbol)) candlesBySymbol.set(candle.symbol, []);
        candlesBySymbol.get(candle.symbol)!.push(candle);
      }

      const symbols = [...candlesBySymbol.keys()];
      this.logger.log(
        `Warming up ${calculators.length} indicators on ${timeframe} with ${validCandles.length} candles` +
          ` (${symbols.map((s) => `${s}: ${candlesBySymbol.get(s)!.length}`).join(', ')})`,
        this.context,
      );

      for (const calc of calculators) {
        // Each calculator declares its symbol in config; feed only matching candles.
        const symbolCandles = candlesBySymbol.get(calc.config.symbol) ?? [];
        calc.warmup(symbolCandles);
      }

      // Track the most recent closed candle per symbol+timeframe for post-warmup seeding.
      for (const candle of validCandles) {
        const key = `${candle.symbol}:${timeframe}`;
        const existing = this.lastCandleByKey.get(key);
        if (!existing || candle.closeTime > existing.closeTime) {
          this.lastCandleByKey.set(key, candle);
        }
      }
    }
  }

  private groupByTimeframe(
    calculators: IIndicatorCalculator[],
  ): Map<Timeframe, IIndicatorCalculator[]> {
    const map = new Map<Timeframe, IIndicatorCalculator[]>();
    for (const calc of calculators) {
      const tf = calc.config.timeframe;
      if (!map.has(tf)) map.set(tf, []);
      map.get(tf)!.push(calc);
    }
    return map;
  }

  /**
   * Fetch historical CLOSED candles for warmup.
   *
   * Strategy:
   *   1. Binance REST API — returns reliably closed candles for any lookback period.
   *   2. Redis stream fallback — used only when Binance is unreachable.
   *
   * The Redis stream is not suitable as the primary warmup source because it only
   * stores live tick updates: the most recent N entries are almost always updates
   * of the current open candle, not distinct closed candles.
   */
  private async fetchHistoricalCandles(timeframe: Timeframe, count: number): Promise<Candle[]> {
    const symbols = this.getDistinctSymbols(timeframe);
    if (symbols.length > 0) {
      try {
        const candles = await this.fetchBinanceKlines(symbols, timeframe, count);
        if (candles.length > 0) {
          this.logger.log(
            `Fetched ${candles.length} closed candles from Binance REST for ${timeframe} (${symbols.join(', ')})`,
            this.context,
          );
          return candles;
        }
      } catch (err) {
        this.logger.warn(
          `Binance REST fetch failed for ${timeframe} — falling back to Redis: ${err instanceof Error ? err.message : String(err)}`,
          this.context,
        );
      }
    }

    return this.fetchFromRedis(timeframe, count);
  }

  /** Distinct symbols registered for the given timeframe (e.g. ['BTC/USDT', 'ETH/USDT']). */
  private getDistinctSymbols(timeframe: Timeframe): string[] {
    const symbols = new Set<string>();
    for (const calc of this.registry.getAll()) {
      if (calc.config.timeframe === timeframe) symbols.add(calc.config.symbol);
    }
    return [...symbols];
  }

  /**
   * Call Binance REST klines endpoint for each symbol and collect the results.
   * Drops the last entry (the current in-progress candle) so only closed candles
   * are returned.  Binance allows up to 1000 entries per request.
   */
  private async fetchBinanceKlines(
    symbols: string[],
    timeframe: Timeframe,
    count: number,
  ): Promise<Candle[]> {
    // Binance interval strings match our Timeframe enum values ('1m', '5m', '15m', '1h').
    const interval = timeframe as string;
    // Request one extra so we can safely drop the in-progress open candle.
    const limit = Math.min(count + 1, 1000);
    const candles: Candle[] = [];

    for (const symbol of symbols) {
      const binanceSymbol = symbol.replace('/', ''); // 'BTC/USDT' → 'BTCUSDT'
      const url =
        `https://api.binance.com/api/v3/klines` +
        `?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;

      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(
          `Binance REST ${url} returned HTTP ${response.status}: ${await response.text()}`,
        );
      }

      // Each entry: [openTime, open, high, low, close, volume, closeTime, ...]
      const data = (await response.json()) as [
        number,
        string,
        string,
        string,
        string,
        string,
        number,
        ...unknown[]
      ][];

      // Drop the last row — it's the current open (in-progress) candle.
      const closedRows = data.slice(0, -1);
      for (const row of closedRows) {
        candles.push({
          symbol,
          exchange: ExchangeId.BINANCE_SPOT,
          timeframe,
          openTime: row[0],
          closeTime: row[6],
          open: parseFloat(row[1]),
          high: parseFloat(row[2]),
          low: parseFloat(row[3]),
          close: parseFloat(row[4]),
          volume: parseFloat(row[5]),
          isClosed: true,
        });
      }
    }

    return candles;
  }

  /** Redis stream fallback — used when Binance REST is unreachable. */
  private async fetchFromRedis(timeframe: Timeframe, count: number): Promise<Candle[]> {
    const streamName = TIMEFRAME_TO_STREAM[timeframe];
    const client = this.redisClient.getClient();

    try {
      // XREVRANGE to get the most recent `count` entries, then reverse
      const raw = (await client.xrevrange(streamName, '+', '-', 'COUNT', count)) as [
        string,
        string[],
      ][];
      if (!raw || raw.length === 0) return [];

      const candles: Candle[] = [];
      for (const [, fields] of raw.reverse()) {
        const parsed = this.parseRawFields(fields, timeframe);
        if (parsed) candles.push(parsed);
      }
      return candles;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch historical candles from ${streamName}: ${err instanceof Error ? err.message : String(err)}`,
        this.context,
      );
      return [];
    }
  }

  private parseRawFields(rawFields: string[], timeframe: Timeframe): Candle | null {
    try {
      const f: Record<string, string> = {};
      for (let i = 0; i < rawFields.length - 1; i += 2) {
        f[rawFields[i]] = rawFields[i + 1];
      }

      const payload: KlineEntry = f['payload']
        ? (JSON.parse(f['payload']) as KlineEntry)
        : ({} as KlineEntry);
      const exchange = f['exchange'] ?? '';
      const symbol = f['symbol'] ?? '';

      return {
        symbol,
        exchange,
        timeframe,
        openTime: Number(payload.openTime),
        closeTime: Number(payload.closeTime),
        open: Number(payload.open),
        high: Number(payload.high),
        low: Number(payload.low),
        close: Number(payload.close),
        volume: Number(payload.volume),
        isClosed: Boolean(payload.isClosed),
      };
    } catch {
      return null;
    }
  }

  private filterValidCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
    // Reset validator context for historical data to avoid false out-of-order errors
    const seenSymbols = new Set(candles.map((c) => c.symbol));
    for (const symbol of seenSymbols) {
      this.validator.resetContext(symbol, timeframe);
    }

    const valid: Candle[] = [];
    for (const candle of candles) {
      const result = this.validator.validate(candle);
      if (result.isOk()) valid.push(candle);
    }
    return valid;
  }

  private timeoutReject(): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Warmup timed out after ${this.warmupTimeoutMs}ms`)),
        this.warmupTimeoutMs,
      ),
    );
  }
}
