import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { HistoricalLoaderFactoryService } from '@modules/backtest/application/historical-loader/historical-loader-factory.service';
import { DataSourceType } from '@modules/backtest/domain/enums/data-source-type.enum';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import {
  ResearchDatasetConfig,
  ResearchDataset,
  ResearchCandle,
} from '../../domain/models/research-dataset.model';
import { ResearchDataType } from '../../domain/enums/research-data-type.enum';
import {
  ResearchDatasetNotFoundError,
  ResearchInsufficientDataError,
} from '../../domain/errors/research.errors';
import { randomUUID } from 'crypto';

/**
 * ResearchDataService provides read-only access to historical market data
 * and alternative data for the research sandbox.
 *
 * ISOLATION GUARANTEE:
 *   This service is READ-ONLY.  It never submits orders, modifies positions,
 *   or writes to any production data store.
 *
 * Data sources:
 *   OHLCV            — loaded via the existing HistoricalLoaderFactoryService
 *                      (same CSV or PostgreSQL sources as the backtester).
 *   Alternative data — stubbed; integrate your data provider in the
 *                      corresponding `load*` private methods.
 *
 * Caching:
 *   Datasets are in-memory cached by config hash for the lifetime of the
 *   module.  Large datasets (>500k candles) bypass the cache to avoid OOM.
 *   The cache is intentionally not shared with the backtester to keep
 *   research memory usage clearly attributable.
 */
@Injectable()
export class ResearchDataService {
  private readonly context = ResearchDataService.name;

  /** In-memory dataset cache: configHash → ResearchDataset */
  private readonly cache = new Map<string, ResearchDataset>();

  /** Maximum candles to cache; larger datasets are re-loaded each time. */
  private static readonly CACHE_MAX_CANDLES = 500_000;

  /** Minimum candles required for a usable dataset. */
  private static readonly MIN_CANDLES = 50;

  constructor(
    private readonly loaderFactory: HistoricalLoaderFactoryService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Loads and returns a research dataset for the given configuration.
   * Cached by config hash — identical configs reuse the cached dataset.
   *
   * @throws ResearchDatasetNotFoundError  When no data is available.
   * @throws ResearchInsufficientDataError When < MIN_CANDLES are returned.
   */
  async load(config: ResearchDatasetConfig): Promise<ResearchDataset> {
    const configHash = this.hashConfig(config);

    if (this.cache.has(configHash)) {
      this.logger.debug?.(
        `Research data cache hit: ${config.symbol} ${config.timeframe} (hash=${configHash})`,
        this.context,
      );
      return this.cache.get(configHash)!;
    }

    this.logger.log(
      `Research data load: ${config.symbol} ${config.timeframe} ` +
        `[${new Date(config.startTimeMs).toISOString()} – ` +
        `${new Date(config.endTimeMs).toISOString()}]`,
      this.context,
    );

    const candles = await this.loadOhlcv(config);

    if (candles.length === 0) {
      throw new ResearchDatasetNotFoundError(
        config.symbol,
        config.timeframe,
        config.startTimeMs,
        config.endTimeMs,
      );
    }

    if (candles.length < ResearchDataService.MIN_CANDLES) {
      throw new ResearchInsufficientDataError(
        ResearchDataService.MIN_CANDLES,
        candles.length,
        `${config.symbol} ${config.timeframe}`,
      );
    }

    const dataset: ResearchDataset = {
      id: randomUUID(),
      config,
      configHash,
      candles,
      fundingRates: config.dataTypes.includes(ResearchDataType.FUNDING_RATE)
        ? await this.loadFundingRates(config)
        : [],
      openInterest: config.dataTypes.includes(ResearchDataType.OPEN_INTEREST)
        ? await this.loadOpenInterest(config)
        : [],
      liquidations: config.dataTypes.includes(ResearchDataType.LIQUIDATIONS)
        ? await this.loadLiquidations(config)
        : [],
      volumeProfile: config.dataTypes.includes(ResearchDataType.VOLUME_PROFILE)
        ? await this.loadVolumeProfile(config)
        : [],
      orderBookSnapshots: config.dataTypes.includes(ResearchDataType.ORDER_BOOK)
        ? await this.loadOrderBookSnapshots(config)
        : [],
      resolvedAt: new Date(),
      candleCount: candles.length,
    };

    if (candles.length <= ResearchDataService.CACHE_MAX_CANDLES) {
      this.cache.set(configHash, dataset);
    } else {
      this.logger.warn(
        `Research dataset too large to cache (${candles.length} candles). ` +
          `Re-loading on each request.`,
        this.context,
      );
    }

    return dataset;
  }

  /**
   * Evicts all cached datasets.
   * Call this when data files on disk have been updated.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Research data cache cleared', this.context);
  }

  /** Returns the number of currently cached datasets. */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ── OHLCV Loading ─────────────────────────────────────────────────────────

  private async loadOhlcv(config: ResearchDatasetConfig): Promise<ResearchCandle[]> {
    try {
      // Prefer PostgreSQL if the timeframe string matches a known Timeframe,
      // otherwise fall back to CSV.  Both are read-only — no writes ever occur.
      const sourceType = Object.values(Timeframe).includes(config.timeframe as Timeframe)
        ? DataSourceType.POSTGRESQL
        : DataSourceType.CSV;

      let loader;
      try {
        loader = this.loaderFactory.resolve(sourceType);
      } catch {
        loader = this.loaderFactory.resolve(DataSourceType.CSV);
      }

      const available = await loader.isAvailable();
      if (!available) {
        this.logger.warn(
          `Historical data loader (${sourceType}) is not available — ` + `falling back to CSV`,
          this.context,
        );
        loader = this.loaderFactory.resolve(DataSourceType.CSV);
      }

      const candles = await loader.load({
        symbol: config.symbol,
        exchange: config.exchangeId,
        timeframe: config.timeframe as Timeframe,
        startTime: config.startTimeMs,
        endTime: config.endTimeMs,
      });

      return candles
        .filter((c) => c.openTime >= config.startTimeMs && c.openTime <= config.endTimeMs)
        .map((c) => ({
          timestampMs: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        .sort((a, b) => a.timestampMs - b.timestampMs);
    } catch (err) {
      this.logger.error(
        `Failed to load OHLCV data for ${config.symbol}: ${(err as Error).message}`,
        (err as Error).stack,
        this.context,
      );
      return [];
    }
  }

  // ── Alternative Data Stubs ─────────────────────────────────────────────────
  // These methods are intentionally empty stubs.
  // Integrate your alternative data provider by replacing the stub body.

  /**
   * Loads funding rate history for the given config.
   * @stub Replace with your data provider integration.
   */
  private async loadFundingRates(
    _config: ResearchDatasetConfig,
  ): Promise<ResearchDataset['fundingRates']> {
    this.logger.debug?.(
      'Research data: funding rate loading not yet configured — returning empty series',
      this.context,
    );
    return [];
  }

  /**
   * Loads open interest history for the given config.
   * @stub Replace with your data provider integration.
   */
  private async loadOpenInterest(
    _config: ResearchDatasetConfig,
  ): Promise<ResearchDataset['openInterest']> {
    this.logger.debug?.(
      'Research data: open interest loading not yet configured — returning empty series',
      this.context,
    );
    return [];
  }

  /**
   * Loads liquidation history for the given config.
   * @stub Replace with your data provider integration.
   */
  private async loadLiquidations(
    _config: ResearchDatasetConfig,
  ): Promise<ResearchDataset['liquidations']> {
    this.logger.debug?.(
      'Research data: liquidation loading not yet configured — returning empty series',
      this.context,
    );
    return [];
  }

  /**
   * Loads volume profile for the given config.
   * @stub Replace with your data provider integration.
   */
  private async loadVolumeProfile(
    _config: ResearchDatasetConfig,
  ): Promise<ResearchDataset['volumeProfile']> {
    this.logger.debug?.(
      'Research data: volume profile loading not yet configured — returning empty series',
      this.context,
    );
    return [];
  }

  /**
   * Loads order book snapshots for the given config.
   * @stub Replace with your data provider integration.
   */
  private async loadOrderBookSnapshots(
    _config: ResearchDatasetConfig,
  ): Promise<ResearchDataset['orderBookSnapshots']> {
    this.logger.debug?.(
      'Research data: order book snapshot loading not yet configured — returning empty series',
      this.context,
    );
    return [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private hashConfig(config: ResearchDatasetConfig): string {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
  }
}
