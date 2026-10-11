import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '../../domain/models/analytics-snapshot.model';

/**
 * ParquetExporterService — STUB (reserved for future implementation).
 *
 * Parquet is a columnar binary format suited for large-scale analytics.
 * It requires an external library (e.g. parquetjs, arrow) that is not yet
 * a dependency of this project.
 *
 * When implemented, this service will:
 *   1. Convert the AnalyticsSnapshot into columnar Arrow Record Batches
 *   2. Serialise to Parquet binary using a Parquet writer
 *   3. Return a Buffer or stream for the caller to persist
 *
 * Until then, exportSnapshot() returns a JSON-encoded Buffer as a fallback
 * and logs a warning so callers know Parquet is not yet available.
 */
@Injectable()
export class ParquetExporterService {
  readonly isAvailable = false;

  /**
   * Fallback: returns a JSON-encoded Buffer.
   * Replace this implementation once a Parquet library is added.
   */
  exportSnapshot(_snapshot: AnalyticsSnapshot): Buffer {
    throw new Error(
      'ParquetExporter is not yet implemented. ' +
        'Use JsonExporterService or CsvExporterService instead. ' +
        'Track implementation progress in the roadmap.',
    );
  }

  /**
   * Returns the list of field names that will be included in the Parquet
   * schema when the exporter is fully implemented.
   */
  getPlannedSchema(): string[] {
    return [
      // Performance
      'snapshot_id',
      'session_id',
      'computed_at',
      'net_profit',
      'gross_profit',
      'gross_loss',
      'total_return_pct',
      'annualized_return_pct',
      'total_trades',
      'winning_trades',
      'losing_trades',
      'win_rate',
      'profit_factor',
      'sharpe_ratio',
      'sortino_ratio',
      'calmar_ratio',
      'max_drawdown',
      'expectancy',
      'payoff_ratio',
      // Execution
      'avg_slippage',
      'avg_latency_ms',
      'fill_rate',
      // Exposure
      'gross_exposure',
      'net_exposure',
      'long_exposure',
      'short_exposure',
      // Rolling (30d)
      'rolling_30d_return',
      'rolling_30d_sharpe',
    ];
  }
}
