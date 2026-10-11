import { ResearchDataType } from '../enums/research-data-type.enum';

/** Configuration that fully identifies a research dataset. */
export interface ResearchDatasetConfig {
  /** Exchange identifier (e.g. 'binance_spot'). */
  readonly exchangeId: string;

  /** Normalized symbol (e.g. 'BTC/USDT'). */
  readonly symbol: string;

  /** Timeframe string (e.g. '1m', '1h', '1d'). */
  readonly timeframe: string;

  /** Inclusive start timestamp in Unix milliseconds. */
  readonly startTimeMs: number;

  /** Inclusive end timestamp in Unix milliseconds. */
  readonly endTimeMs: number;

  /** Types of data to load. Defaults to [OHLCV]. */
  readonly dataTypes: ResearchDataType[];
}

/** A single OHLCV bar as used inside the research sandbox. */
export interface ResearchCandle {
  readonly timestampMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** One funding rate record. */
export interface ResearchFundingRate {
  readonly timestampMs: number;
  readonly symbol: string;
  readonly rate: number;
  /** Predicted next rate if available. */
  readonly predictedRate?: number;
}

/** Aggregate open interest record. */
export interface ResearchOpenInterest {
  readonly timestampMs: number;
  readonly symbol: string;
  readonly openInterest: number;
}

/** One liquidation event. */
export interface ResearchLiquidation {
  readonly timestampMs: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly price: number;
  readonly usdValue: number;
}

/** Volume profile bucket (price level → volume). */
export interface ResearchVolumeProfileBucket {
  readonly priceLow: number;
  readonly priceHigh: number;
  readonly volume: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
}

/** Order book snapshot at a point in time. */
export interface ResearchOrderBookSnapshot {
  readonly timestampMs: number;
  readonly bids: ReadonlyArray<readonly [price: number, quantity: number]>;
  readonly asks: ReadonlyArray<readonly [price: number, quantity: number]>;
  readonly midPrice: number;
  readonly spread: number;
}

/**
 * Resolved research dataset: candles plus any requested alternative data,
 * identified by a content hash for caching and reproducibility.
 */
export interface ResearchDataset {
  readonly id: string;
  readonly config: ResearchDatasetConfig;
  /** SHA-256 hex of the serialised config for reproducibility checks. */
  readonly configHash: string;
  readonly candles: ResearchCandle[];
  readonly fundingRates: ResearchFundingRate[];
  readonly openInterest: ResearchOpenInterest[];
  readonly liquidations: ResearchLiquidation[];
  readonly volumeProfile: ResearchVolumeProfileBucket[];
  readonly orderBookSnapshots: ResearchOrderBookSnapshot[];
  readonly resolvedAt: Date;
  readonly candleCount: number;
}
