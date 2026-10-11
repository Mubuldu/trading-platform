import { ExperimentStatus } from '../enums/experiment-status.enum';
import { MlFramework } from '../enums/ml-framework.enum';
import { PromotionStage } from '../enums/promotion-stage.enum';
import { ResearchDatasetConfig } from './research-dataset.model';

// ─── Feature Engineering ─────────────────────────────────────────────────────

export type FeatureTransform =
  | 'ZSCORE' // (x - μ) / σ  over rolling window
  | 'MIN_MAX' // (x - min) / (max - min) over rolling window
  | 'LOG_RETURN' // log(x / x_prev)
  | 'PCT_CHANGE' // (x - x_prev) / x_prev
  | 'DIFF' // x - x_prev
  | 'RANK' // percentile rank over rolling window
  | 'NONE'; // pass-through

export interface FeatureDefinition {
  /** Output column name. */
  readonly name: string;
  /** Input source column (e.g. 'close', 'volume', 'rsi_14'). */
  readonly source: string;
  /** Transformation to apply. */
  readonly transform: FeatureTransform;
  /** Lookback window for rolling transforms (required for ZSCORE/MIN_MAX/RANK). */
  readonly window?: number;
  /** Lag in bars to apply after transformation (0 = same bar). */
  readonly lag?: number;
}

export interface FeatureEngineeringConfig {
  readonly features: FeatureDefinition[];
  /** Number of warm-up bars discarded after feature computation. */
  readonly warmupBars: number;
}

// ─── Custom Indicator ─────────────────────────────────────────────────────────

export interface CustomIndicatorDefinition {
  /** Unique name used to reference this indicator as a feature source. */
  readonly name: string;
  /** Indicator type registered in the sandbox (e.g. 'VWAP', 'ENTROPY'). */
  readonly type: string;
  /** Type-specific parameters. */
  readonly params: Record<string, unknown>;
}

// ─── Experiment Config ────────────────────────────────────────────────────────

export interface ExperimentConfig {
  /** Dataset to run the experiment on. */
  readonly datasetConfig: ResearchDatasetConfig;

  /** Strategy or model hyperparameters — fully serialisable. */
  readonly parameters: Record<string, unknown>;

  /** ML framework to use. Defaults to TYPESCRIPT_NATIVE. */
  readonly mlFramework?: MlFramework;

  /**
   * Path to ONNX model file (required when mlFramework = ONNX).
   * Must be within the research data directory; absolute paths outside are rejected.
   */
  readonly onnxModelPath?: string;

  /**
   * Path to Python script to execute (required for PYTHON_* frameworks).
   * Must be within the research sandbox directory.
   */
  readonly pythonScriptPath?: string;

  /** Feature engineering pipeline applied to raw market data before the model. */
  readonly featureEngineering?: FeatureEngineeringConfig;

  /** Custom indicator definitions evaluated before feature engineering. */
  readonly customIndicators?: CustomIndicatorDefinition[];

  /** Initial capital for P&L simulation within the experiment. */
  readonly initialCapitalUsd?: number;

  /** Commission in basis points. Defaults to 10 bps (0.10%). */
  readonly commissionBps?: number;

  /** Slippage in basis points. Defaults to 5 bps (0.05%). */
  readonly slippageBps?: number;
}

// ─── Experiment ───────────────────────────────────────────────────────────────

export interface Experiment {
  /** UUID v4 — stable identifier for the lifetime of the experiment. */
  readonly id: string;

  /** Human-readable name (unique within the researcher's workspace). */
  readonly name: string;

  /** Purpose and hypothesis of this experiment. */
  readonly description: string;

  /** Full reproducible configuration. */
  readonly config: ExperimentConfig;

  /**
   * Git commit hash of the code version used.
   * Captured at experiment creation time from `git rev-parse HEAD`.
   */
  readonly commitHash: string;

  /**
   * Seed for all random number generators used during the experiment.
   * Must be explicitly set so results are deterministic.
   */
  readonly randomSeed: number;

  /** Current lifecycle state. */
  status: ExperimentStatus;

  /** Current promotion stage. */
  promotionStage: PromotionStage;

  /** Free-form classification tags (e.g. ['momentum', 'crypto', 'intraday']). */
  readonly tags: string[];

  readonly createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
}
