import { ApplicationError } from '@common/errors/application.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

/**
 * Abstract base for all research-sandbox failures.
 *
 * Each concrete subclass must declare:
 *   readonly code = ErrorCode.RESEARCH_*;
 */
export abstract class ResearchError extends ApplicationError {}

// ─── Experiment Lifecycle ─────────────────────────────────────────────────────

export class ResearchExperimentNotFoundError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_EXPERIMENT_NOT_FOUND;

  constructor(experimentId: string) {
    super(`Research experiment not found: ${experimentId}`);
    this.name = 'ResearchExperimentNotFoundError';
  }
}

export class ResearchExperimentAlreadyExistsError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_EXPERIMENT_ALREADY_EXISTS;

  constructor(name: string) {
    super(`Research experiment already exists with name: ${name}`);
    this.name = 'ResearchExperimentAlreadyExistsError';
  }
}

export class ResearchReproducibilityError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_REPRODUCIBILITY_FAILED;

  constructor(experimentId: string, reason: string) {
    super(`Reproducibility failure for experiment ${experimentId}: ${reason}`);
    this.name = 'ResearchReproducibilityError';
  }
}

// ─── Promotion Pipeline ───────────────────────────────────────────────────────

export class ResearchPromotionStageMissingError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_PROMOTION_STAGE_SKIPPED;

  constructor(experimentId: string, fromStage: string, toStage: string, requiredStage: string) {
    super(
      `Cannot promote experiment ${experimentId} from ${fromStage} to ${toStage}: ` +
        `stage ${requiredStage} has not been completed`,
    );
    this.name = 'ResearchPromotionStageMissingError';
  }
}

export class ResearchInvalidPromotionStageError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_INVALID_PROMOTION_STAGE;

  constructor(experimentId: string, reason: string) {
    super(`Invalid promotion stage transition for experiment ${experimentId}: ${reason}`);
    this.name = 'ResearchInvalidPromotionStageError';
  }
}

// ─── Python Bridge ────────────────────────────────────────────────────────────

export class ResearchPythonBridgeError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_PYTHON_BRIDGE_FAILED;

  constructor(scriptPath: string, cause?: Error) {
    super(`Python bridge execution failed for script: ${scriptPath}`, undefined, cause);
    this.name = 'ResearchPythonBridgeError';
  }
}

// ─── ONNX Inference ───────────────────────────────────────────────────────────

export class ResearchOnnxInferenceError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_ONNX_INFERENCE_FAILED;

  constructor(modelPath: string, cause?: Error) {
    super(`ONNX inference failed for model: ${modelPath}`, undefined, cause);
    this.name = 'ResearchOnnxInferenceError';
  }
}

// ─── Dataset ─────────────────────────────────────────────────────────────────

export class ResearchDatasetNotFoundError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_DATASET_NOT_FOUND;

  constructor(symbol: string, timeframe: string, startMs: number, endMs: number) {
    super(`Research dataset not found: ${symbol} ${timeframe} [${startMs}–${endMs}]`);
    this.name = 'ResearchDatasetNotFoundError';
  }
}

export class ResearchInsufficientDataError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_INSUFFICIENT_DATA;

  constructor(required: number, available: number, context: string) {
    super(`Insufficient data for ${context}: need ≥${required} bars, have ${available}`);
    this.name = 'ResearchInsufficientDataError';
  }
}

// ─── Statistical Validation ───────────────────────────────────────────────────

export class ResearchStatisticalValidationError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_STATISTICAL_VALIDATION_FAILED;

  constructor(experimentId: string, pValue: number) {
    super(
      `Experiment ${experimentId} rejected: p-value ${pValue.toFixed(4)} ≥ 0.05 — ` +
        `returns are not statistically distinguishable from zero`,
    );
    this.name = 'ResearchStatisticalValidationError';
  }
}

// ─── Isolation Guard ─────────────────────────────────────────────────────────

export class ResearchProductionContaminationError extends ResearchError {
  override readonly code = ErrorCode.RESEARCH_PRODUCTION_CONTAMINATION;

  constructor(offendingOperation: string) {
    super(
      `Research sandbox isolation violation: "${offendingOperation}" attempted to ` +
        `access or modify production systems. This operation is forbidden in the sandbox.`,
    );
    this.name = 'ResearchProductionContaminationError';
  }
}
