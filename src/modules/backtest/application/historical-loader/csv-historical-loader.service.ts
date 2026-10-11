import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { BacktestingConfig } from '@config/backtesting.config';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { DataSourceType } from '../../domain/enums/data-source-type.enum';
import {
  BacktestDataLoadFailedError,
  BacktestDataCorruptError,
  BacktestDataEmptyError,
} from '../../domain/errors/backtest.errors';
import {
  IHistoricalDataLoader,
  HistoricalDataRange,
} from './interfaces/historical-data-loader.interface';

const MIN_VALID_TIMESTAMP = 1_000_000_000_000; // year 2001 in ms
const MAX_VALID_PRICE = 1_000_000_000;

@Injectable()
export class CsvHistoricalLoaderService implements IHistoricalDataLoader {
  readonly sourceType = DataSourceType.CSV;

  private readonly dataDir: string;

  constructor(configService: ConfigService) {
    const cfg = configService.get<BacktestingConfig>('backtesting')!;
    this.dataDir = cfg.dataDir;
  }

  async load(range: HistoricalDataRange): Promise<Candle[]> {
    const filePath = this.resolveFilePath(range);

    if (!existsSync(filePath)) {
      throw new BacktestDataLoadFailedError(filePath, 'File not found');
    }

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (e) {
      throw new BacktestDataLoadFailedError(filePath, (e as Error).message);
    }

    const candles = this.parse(raw, range, filePath);

    const filtered = candles.filter(
      (c) => c.openTime >= range.startTime && c.openTime <= range.endTime,
    );

    if (filtered.length === 0) {
      throw new BacktestDataEmptyError(
        range.symbol,
        range.timeframe,
        range.startTime,
        range.endTime,
      );
    }

    return filtered;
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.dataDir);
  }

  loadFromPath(filePath: string, range: HistoricalDataRange): Promise<Candle[]> {
    return this.loadFromAbsolutePath(filePath, range);
  }

  private async loadFromAbsolutePath(
    filePath: string,
    range: HistoricalDataRange,
  ): Promise<Candle[]> {
    if (!existsSync(filePath)) {
      throw new BacktestDataLoadFailedError(filePath, 'File not found');
    }
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (e) {
      throw new BacktestDataLoadFailedError(filePath, (e as Error).message);
    }
    const candles = this.parse(raw, range, filePath);
    const filtered = candles.filter(
      (c) => c.openTime >= range.startTime && c.openTime <= range.endTime,
    );
    if (filtered.length === 0) {
      throw new BacktestDataEmptyError(
        range.symbol,
        range.timeframe,
        range.startTime,
        range.endTime,
      );
    }
    return filtered;
  }

  private resolveFilePath(range: HistoricalDataRange): string {
    const name = `${range.exchange}_${range.symbol.replace('/', '_')}_${range.timeframe}.csv`;
    return path.join(this.dataDir, name);
  }

  private parse(raw: string, range: HistoricalDataRange, _filePath: string): Candle[] {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      throw new BacktestDataEmptyError(
        range.symbol,
        range.timeframe,
        range.startTime,
        range.endTime,
      );
    }

    const firstLine = lines[0].toLowerCase();
    const startIndex = firstLine.includes('timestamp') || firstLine.includes('open') ? 1 : 0;

    const candles: Candle[] = [];
    let previousOpenTime = -1;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      const parts = line.split(',');
      if (parts.length < 6) {
        throw new BacktestDataCorruptError(
          `Expected 6 columns (timestamp,open,high,low,close,volume), got ${parts.length}`,
          lineNumber,
        );
      }

      const openTime = parseInt(parts[0].trim(), 10);
      const open = parseFloat(parts[1].trim());
      const high = parseFloat(parts[2].trim());
      const low = parseFloat(parts[3].trim());
      const close = parseFloat(parts[4].trim());
      const volume = parseFloat(parts[5].trim());

      if (!Number.isFinite(openTime) || openTime < MIN_VALID_TIMESTAMP) {
        throw new BacktestDataCorruptError(`Invalid timestamp ${openTime}`, lineNumber);
      }
      if (!Number.isFinite(open) || open <= 0 || open > MAX_VALID_PRICE) {
        throw new BacktestDataCorruptError(`Invalid open price ${open}`, lineNumber);
      }
      if (!Number.isFinite(high) || high < open || high > MAX_VALID_PRICE) {
        throw new BacktestDataCorruptError(
          `Invalid high price ${high} (must be >= open ${open})`,
          lineNumber,
        );
      }
      if (!Number.isFinite(low) || low > open || low <= 0) {
        throw new BacktestDataCorruptError(
          `Invalid low price ${low} (must be <= open ${open} and > 0)`,
          lineNumber,
        );
      }
      if (!Number.isFinite(close) || close <= 0 || close > MAX_VALID_PRICE) {
        throw new BacktestDataCorruptError(`Invalid close price ${close}`, lineNumber);
      }
      if (!Number.isFinite(volume) || volume < 0) {
        throw new BacktestDataCorruptError(`Invalid volume ${volume}`, lineNumber);
      }
      if (high < low) {
        throw new BacktestDataCorruptError(`High ${high} is less than low ${low}`, lineNumber);
      }
      if (openTime <= previousOpenTime && previousOpenTime !== -1) {
        throw new BacktestDataCorruptError(
          `Timestamps are not strictly ascending: ${openTime} <= ${previousOpenTime}`,
          lineNumber,
        );
      }

      previousOpenTime = openTime;

      candles.push({
        symbol: range.symbol,
        exchange: range.exchange,
        timeframe: range.timeframe,
        openTime,
        closeTime: this.computeCloseTime(openTime, range.timeframe),
        open,
        high,
        low,
        close,
        volume,
        isClosed: true,
      });
    }

    return candles;
  }

  private computeCloseTime(openTime: number, timeframe: Timeframe): number {
    const durations: Record<Timeframe, number> = {
      [Timeframe.ONE_MINUTE]: 60_000,
      [Timeframe.FIVE_MINUTES]: 300_000,
      [Timeframe.FIFTEEN_MINUTES]: 900_000,
      [Timeframe.ONE_HOUR]: 3_600_000,
    };
    return openTime + (durations[timeframe] ?? 60_000) - 1;
  }
}
