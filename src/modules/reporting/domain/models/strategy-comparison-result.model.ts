import { StrategyMetricRow } from './sections/strategy-comparison.section';

/**
 * StrategyComparisonResult is the output of StrategyComparatorService.
 *
 * It is used internally by the ReportGeneratorService to populate
 * the StrategyComparisonSection of a multi-strategy report.
 */
export interface StrategyComparisonResult {
  readonly strategies: StrategyMetricRow[];
  readonly bestByReturn: string;
  readonly bestBySharpe: string;
  readonly bestBySortino: string;
  readonly bestByCalmar: string;
  readonly bestByDrawdown: string;
  readonly bestByExpectancy: string;
  readonly bestByProfitFactor: string;
}
