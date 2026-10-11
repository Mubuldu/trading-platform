import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { BacktestingConfig } from '@config/backtesting.config';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { DataSourceType } from '../../domain/enums/data-source-type.enum';
import {
  BacktestDataEmptyError,
  BacktestDataLoadFailedError,
} from '../../domain/errors/backtest.errors';
import {
  IHistoricalDataLoader,
  HistoricalDataRange,
} from './interfaces/historical-data-loader.interface';

/** Binance REST kline array field indices. */
const FIELD = {
  OPEN_TIME: 0,
  OPEN: 1,
  HIGH: 2,
  LOW: 3,
  CLOSE: 4,
  VOLUME: 5,
  CLOSE_TIME: 6,
} as const;

const BINANCE_BASE_URL = 'https://api.binance.com';
const PAGE_LIMIT = 1000; // max candles per Binance /klines request
const PAGE_DELAY_MS = 60; // ≈ 1000 req/min; each request weighs 2 → well under 1200 weight/min

/**
 * BinanceHistoricalFeedService downloads historical OHLCV candles from the
 * Binance public REST API and caches them to disk so re-runs are instant.
 *
 * Rate limiting: each /klines request costs 2 weight. With a 60 ms delay
 * between pages the service issues at most ~16 req/s → ~1000 weight/min,
 * safely under Binance's 1200 weight/min limit.
 *
 * Cache layout: {dataDir}/binance-cache/{SYMBOL}_{timeframe}_{startMs}_{endMs}.json
 * The file holds a JSON array of Candle objects. Once written it is never
 * invalidated — pass a different date range to force a fresh download.
 */
@Injectable()
export class BinanceHistoricalFeedService implements IHistoricalDataLoader {
  readonly sourceType = DataSourceType.BINANCE;

  private readonly context = BinanceHistoricalFeedService.name;
  private readonly cacheDir: string;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = configService.get<BacktestingConfig>('backtesting')!;
    this.cacheDir = path.join(cfg.dataDir, 'binance-cache');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IHistoricalDataLoader
  // ─────────────────────────────────────────────────────────────────────────

  async load(range: HistoricalDataRange): Promise<Candle[]> {
    const cacheFile = this.resolveCachePath(range);

    if (existsSync(cacheFile)) {
      this.logger.log(`Binance cache hit: ${path.basename(cacheFile)}`, this.context);
      try {
        const raw = await readFile(cacheFile, 'utf8');
        const candles = JSON.parse(raw) as Candle[];
        this.logger.log(
          `Loaded ${candles.length} candles from disk cache`,
          this.context,
        );
        return candles;
      } catch (e) {
        this.logger.warn(
          `Cache file corrupt, re-downloading: ${(e as Error).message}`,
          this.context,
        );
      }
    }

    const exchangeSymbol = this.toExchangeSymbol(range.symbol);

    this.logger.log(
      `Downloading ${exchangeSymbol} ${range.timeframe} from Binance ` +
        `[${new Date(range.startTime).toISOString()} → ${new Date(range.endTime).toISOString()}]`,
      this.context,
    );

    const candles = await this.fetchAllPages(
      exchangeSymbol,
      range.symbol,
      range.timeframe,
      range.startTime,
      range.endTime,
    );

    if (candles.length === 0) {
      throw new BacktestDataEmptyError(
        range.symbol,
        range.timeframe,
        range.startTime,
        range.endTime,
      );
    }

    await this.persistCache(cacheFile, candles);
    return candles;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${BINANCE_BASE_URL}/api/v3/ping`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pagination
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Paginate through Binance klines, advancing the cursor to the close time
   * of the last candle on each page. Stops when the API returns fewer than
   * PAGE_LIMIT candles (last page) or the cursor reaches endMs.
   */
  private async fetchAllPages(
    exchangeSymbol: string,
    normalizedSymbol: string,
    timeframe: Timeframe,
    startMs: number,
    endMs: number,
  ): Promise<Candle[]> {
    const all: Candle[] = [];
    let cursor = startMs;
    let page = 1;

    while (cursor < endMs) {
      this.logger.log(
        `Page ${page}: ${exchangeSymbol} ${timeframe} from ${new Date(cursor).toISOString()}`,
        this.context,
      );

      const candles = await this.fetchPage(
        exchangeSymbol,
        normalizedSymbol,
        timeframe,
        cursor,
        endMs,
      );

      if (candles.length === 0) break;

      all.push(...candles);

      const lastCandle = candles[candles.length - 1];
      cursor = lastCandle.closeTime + 1; // advance past last close

      if (candles.length < PAGE_LIMIT) break; // reached the end of available data

      page++;
      await this.sleep(PAGE_DELAY_MS);
    }

    this.logger.log(
      `Downloaded ${all.length} candles over ${page} page(s) for ${exchangeSymbol}`,
      this.context,
    );

    return all;
  }

  /**
   * Fetch one page (up to PAGE_LIMIT candles) from the Binance klines endpoint.
   */
  private async fetchPage(
    exchangeSymbol: string,
    normalizedSymbol: string,
    timeframe: Timeframe,
    startMs: number,
    endMs: number,
  ): Promise<Candle[]> {
    const url = new URL(`${BINANCE_BASE_URL}/api/v3/klines`);
    url.searchParams.set('symbol', exchangeSymbol);
    url.searchParams.set('interval', timeframe); // Timeframe values match Binance intervals: '1m','5m','15m','1h'
    url.searchParams.set('startTime', String(startMs));
    url.searchParams.set('endTime', String(endMs));
    url.searchParams.set('limit', String(PAGE_LIMIT));

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new BacktestDataLoadFailedError('binance', `Network error: ${(e as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BacktestDataLoadFailedError(
        'binance',
        `HTTP ${response.status} ${response.statusText}: ${body}`,
      );
    }

    // Binance kline response: Array<[openTime, open, high, low, close, volume, closeTime, ...]>
    // openTime and closeTime are numbers; prices and volumes are decimal strings.
    const rows = (await response.json()) as Array<Array<string | number>>;

    return rows.map((row) => this.mapRow(row, normalizedSymbol, timeframe));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private mapRow(
    row: Array<string | number>,
    normalizedSymbol: string,
    timeframe: Timeframe,
  ): Candle {
    return {
      symbol: normalizedSymbol,            // e.g. 'BTC/USDT'
      exchange: 'BINANCE',
      timeframe,
      openTime: row[FIELD.OPEN_TIME] as number,
      closeTime: row[FIELD.CLOSE_TIME] as number,
      open: parseFloat(row[FIELD.OPEN] as string),
      high: parseFloat(row[FIELD.HIGH] as string),
      low: parseFloat(row[FIELD.LOW] as string),
      close: parseFloat(row[FIELD.CLOSE] as string),
      volume: parseFloat(row[FIELD.VOLUME] as string),
      isClosed: true,
    };
  }

  /** 'BTC/USDT' → 'BTCUSDT' */
  private toExchangeSymbol(normalizedSymbol: string): string {
    return normalizedSymbol.replace('/', '');
  }

  /**
   * Cache file path: {cacheDir}/{BTCUSDT}_{1h}_{startMs}_{endMs}.json
   * Using the exact (startMs, endMs) pair so multiple overlapping ranges
   * each get their own file rather than partial matches being returned.
   */
  private resolveCachePath(range: HistoricalDataRange): string {
    const sym = this.toExchangeSymbol(range.symbol);
    const name = `${sym}_${range.timeframe}_${range.startTime}_${range.endTime}.json`;
    return path.join(this.cacheDir, name);
  }

  private async persistCache(filePath: string, candles: Candle[]): Promise<void> {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(candles), 'utf8');
      this.logger.log(
        `Cached ${candles.length} candles → ${path.basename(filePath)}`,
        this.context,
      );
    } catch (e) {
      // Cache write failure is non-fatal; the candles are already in memory.
      this.logger.warn(
        `Failed to write disk cache: ${(e as Error).message}`,
        this.context,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
