import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  PromotionStage,
  PROMOTION_STAGE_ORDER,
  PROMOTION_PIPELINE,
} from '../domain/enums/promotion-stage.enum';
import { ExperimentStatus } from '../domain/enums/experiment-status.enum';
import {
  PromotionRequest,
  PromotionRecord,
  StageValidationResult,
} from '../domain/models/promotion-request.model';
import { ExperimentMetrics } from '../domain/models/experiment-result.model';
import { ExperimentStorageService } from '../storage/experiment-storage.service';
import { ExperimentTrackerService } from '../application/services/experiment-tracker.service';
import {
  ResearchExperimentNotFoundError,
  ResearchInvalidPromotionStageError,
  ResearchPromotionStageMissingError,
  ResearchStatisticalValidationError,
  ResearchProductionContaminationError,
} from '../domain/errors/research.errors';

// ─── Stage-Level Validation Thresholds ───────────────────────────────────────

/** Minimum Sharpe ratio required to pass VALIDATION. */
const VALIDATION_MIN_SHARPE = 0.5;

/** Maximum max-drawdown percent allowed at WALK_FORWARD. */
const WALK_FORWARD_MAX_DRAWDOWN = 35;

/** Maximum max-drawdown percent allowed at MONTE_CARLO. */
const MONTE_CARLO_MAX_DRAWDOWN = 40;

/** Minimum win-rate required at PAPER_TRADING. */
const PAPER_TRADING_MIN_WIN_RATE = 0.45;

/** Minimum Sharpe required at PAPER_TRADING. */
const PAPER_TRADING_MIN_SHARPE = 0.8;

/**
 * Expected token format: `APPROVE-PRODUCTION-{experimentId}`.
 * The pipeline verifies this prefix as a lightweight confirmation that the
 * operator understands they are deploying to live capital.
 */
const PRODUCTION_APPROVAL_TOKEN_PREFIX = 'APPROVE-PRODUCTION-';

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * PromotionPipelineService enforces the research-to-production promotion
 * pipeline with strict stage ordering.
 *
 * Pipeline (no stage may be skipped):
 *   RESEARCH → VALIDATION → WALK_FORWARD → MONTE_CARLO
 *     → PAPER_TRADING → MANUAL_APPROVAL → PRODUCTION
 *
 * Terminal stages: PRODUCTION (success), REJECTED (failure).
 *
 * Each stage has configurable validation thresholds gating advancement.
 * The MANUAL_APPROVAL → PRODUCTION transition additionally requires a
 * `productionApprovalToken` in the PromotionRequest to confirm human intent.
 *
 * ISOLATION:
 *   This service records promotion decisions only.  It never calls order
 *   management, execution, or any production trading system.  Deployment
 *   to production is a separate out-of-band step performed by operators.
 */
@Injectable()
export class PromotionPipelineService {
  private readonly context = PromotionPipelineService.name;

  constructor(
    private readonly storage: ExperimentStorageService,
    private readonly tracker: ExperimentTrackerService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attempts to advance an experiment to the requested stage.
   *
   * @throws ResearchExperimentNotFoundError         if the experiment doesn't exist.
   * @throws ResearchInvalidPromotionStageError      if targetStage is already past, is the same,
   *                                                  or is not a valid pipeline stage.
   * @throws ResearchPromotionStageMissingError      if a stage would be skipped.
   * @throws ResearchStatisticalValidationError      if the experiment is not statistically valid.
   * @throws ResearchProductionContaminationError    if PRODUCTION is requested without approval token.
   */
  async promote(request: PromotionRequest): Promise<StageValidationResult> {
    const { experimentId, targetStage, initiatedBy, reason } = request;

    // Validate experiment exists and is in a promotable state
    const exp = await this.storage.findById(experimentId);
    if (!exp) throw new ResearchExperimentNotFoundError(experimentId);

    const currentStage = exp.promotionStage;

    // Check that the target stage is valid in the pipeline
    this.assertValidTargetStage(currentStage, targetStage, experimentId);

    // Require approval token for the final production gate
    if (targetStage === PromotionStage.PRODUCTION) {
      this.assertProductionApprovalToken(request, experimentId);
    }

    // Load the result for metric-based validation
    const result = await this.storage.findResultById(experimentId);

    // Statistical validity is required for any forward promotion
    if (result && !result.metrics.isStatisticallyValid) {
      throw new ResearchStatisticalValidationError(experimentId, result.metrics.pValue);
    }

    // Stage-specific metric validation
    const validationResult = result
      ? this.validateStageMetrics(targetStage, result.metrics, experimentId)
      : this.noResultValidation(targetStage, experimentId);

    if (!validationResult.passed) {
      this.logger.warn(
        `Promotion blocked: ${experimentId} → ${targetStage}: ${validationResult.notes}`,
        this.context,
      );
      return validationResult;
    }

    // Record promotion
    const record: PromotionRecord = {
      fromStage: currentStage,
      toStage: targetStage,
      initiatedBy,
      reason,
      approvedAt: new Date(),
    };

    await this.tracker.updatePromotionStage(experimentId, targetStage, record);

    this.logger.log(
      `Experiment ${experimentId} promoted: ${currentStage} → ${targetStage} ` +
        `(by: ${initiatedBy})`,
      this.context,
    );

    return validationResult;
  }

  /**
   * Rejects an experiment — moves it to REJECTED terminal state.
   * Can be called from any stage; no metric validation is performed.
   */
  async reject(experimentId: string, initiatedBy: string, reason: string): Promise<void> {
    const exp = await this.storage.findById(experimentId);
    if (!exp) throw new ResearchExperimentNotFoundError(experimentId);

    if (exp.promotionStage === PromotionStage.PRODUCTION) {
      // Safety: never unilaterally reject a live production strategy via this API
      throw new ResearchProductionContaminationError(
        'Cannot reject a live production strategy via the research pipeline. ' +
          'Use the production system decommission workflow instead.',
      );
    }

    const record: PromotionRecord = {
      fromStage: exp.promotionStage,
      toStage: PromotionStage.REJECTED,
      initiatedBy,
      reason,
      approvedAt: new Date(),
    };

    await this.tracker.updatePromotionStage(experimentId, PromotionStage.REJECTED, record);

    this.logger.log(
      `Experiment ${experimentId} REJECTED from ${exp.promotionStage} ` +
        `(by: ${initiatedBy}): ${reason}`,
      this.context,
    );
  }

  /**
   * Returns the next expected stage for the given experiment.
   * Returns null if the experiment is at a terminal stage.
   */
  getNextStage(currentStage: PromotionStage): PromotionStage | null {
    if (currentStage === PromotionStage.PRODUCTION || currentStage === PromotionStage.REJECTED) {
      return null;
    }
    const idx = PROMOTION_PIPELINE.indexOf(currentStage);
    if (idx < 0 || idx >= PROMOTION_PIPELINE.length - 1) return null;
    return PROMOTION_PIPELINE[idx + 1] ?? null;
  }

  /**
   * Returns the full promotion history for an experiment.
   */
  async getPromotionHistory(experimentId: string): Promise<PromotionRecord[]> {
    const exp = await this.storage.findById(experimentId);
    if (!exp) throw new ResearchExperimentNotFoundError(experimentId);
    return this.storage.getPromotionHistory(experimentId);
  }

  /**
   * Returns whether an experiment can currently be promoted (is in a
   * non-terminal stage and has COMPLETED status).
   */
  async canPromote(experimentId: string): Promise<boolean> {
    const exp = await this.storage.findById(experimentId);
    if (!exp) return false;
    if (exp.status !== ExperimentStatus.COMPLETED) return false;
    return (
      exp.promotionStage !== PromotionStage.PRODUCTION &&
      exp.promotionStage !== PromotionStage.REJECTED
    );
  }

  // ── Stage Validation ──────────────────────────────────────────────────────

  /**
   * Validates that the target stage passes stage-specific metric thresholds.
   * Returns a StageValidationResult with passed=false if any check fails;
   * the promote() caller stops the promotion and returns the result.
   */
  private validateStageMetrics(
    targetStage: PromotionStage,
    metrics: ExperimentMetrics,
    _experimentId: string,
  ): StageValidationResult {
    const now = new Date();
    const metricSnapshot: Record<string, number> = {
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      maxDrawdownPercent: metrics.maxDrawdownPercent,
      winRate: metrics.winRate,
      totalReturnPercent: metrics.totalReturnPercent,
      pValue: metrics.pValue,
    };

    switch (targetStage) {
      case PromotionStage.VALIDATION: {
        const passed = metrics.sharpeRatio >= VALIDATION_MIN_SHARPE;
        return {
          stage: targetStage,
          passed,
          metrics: metricSnapshot,
          notes: passed
            ? `Sharpe ${metrics.sharpeRatio.toFixed(2)} ≥ ${VALIDATION_MIN_SHARPE}`
            : `Sharpe ${metrics.sharpeRatio.toFixed(2)} < required ${VALIDATION_MIN_SHARPE}`,
          validatedAt: now,
        };
      }

      case PromotionStage.WALK_FORWARD: {
        const passed = metrics.maxDrawdownPercent <= WALK_FORWARD_MAX_DRAWDOWN;
        return {
          stage: targetStage,
          passed,
          metrics: metricSnapshot,
          notes: passed
            ? `Max drawdown ${metrics.maxDrawdownPercent.toFixed(1)}% ≤ ${WALK_FORWARD_MAX_DRAWDOWN}%`
            : `Max drawdown ${metrics.maxDrawdownPercent.toFixed(1)}% > limit ${WALK_FORWARD_MAX_DRAWDOWN}%`,
          validatedAt: now,
        };
      }

      case PromotionStage.MONTE_CARLO: {
        const passed =
          metrics.maxDrawdownPercent <= MONTE_CARLO_MAX_DRAWDOWN &&
          metrics.sharpeRatio >= VALIDATION_MIN_SHARPE;
        const notes: string[] = [];
        if (metrics.maxDrawdownPercent > MONTE_CARLO_MAX_DRAWDOWN)
          notes.push(
            `MaxDD ${metrics.maxDrawdownPercent.toFixed(1)}% > ${MONTE_CARLO_MAX_DRAWDOWN}%`,
          );
        if (metrics.sharpeRatio < VALIDATION_MIN_SHARPE)
          notes.push(`Sharpe ${metrics.sharpeRatio.toFixed(2)} < ${VALIDATION_MIN_SHARPE}`);
        return {
          stage: targetStage,
          passed,
          metrics: metricSnapshot,
          notes: passed ? 'Monte Carlo thresholds met' : notes.join('; '),
          validatedAt: now,
        };
      }

      case PromotionStage.PAPER_TRADING: {
        const passed =
          metrics.winRate >= PAPER_TRADING_MIN_WIN_RATE &&
          metrics.sharpeRatio >= PAPER_TRADING_MIN_SHARPE;
        const notes: string[] = [];
        if (metrics.winRate < PAPER_TRADING_MIN_WIN_RATE)
          notes.push(
            `Win rate ${(metrics.winRate * 100).toFixed(1)}% < ${(PAPER_TRADING_MIN_WIN_RATE * 100).toFixed(0)}%`,
          );
        if (metrics.sharpeRatio < PAPER_TRADING_MIN_SHARPE)
          notes.push(`Sharpe ${metrics.sharpeRatio.toFixed(2)} < ${PAPER_TRADING_MIN_SHARPE}`);
        return {
          stage: targetStage,
          passed,
          metrics: metricSnapshot,
          notes: passed ? 'Paper trading thresholds met' : notes.join('; '),
          validatedAt: now,
        };
      }

      case PromotionStage.MANUAL_APPROVAL:
      case PromotionStage.PRODUCTION:
      case PromotionStage.RESEARCH:
        // These stages have no automatic metric threshold — human decision.
        return {
          stage: targetStage,
          passed: true,
          metrics: metricSnapshot,
          notes: `${targetStage}: no automatic threshold — human decision required`,
          validatedAt: now,
        };

      case PromotionStage.REJECTED:
        return {
          stage: targetStage,
          passed: true,
          metrics: metricSnapshot,
          notes: 'Rejection recorded',
          validatedAt: now,
        };
    }
  }

  /** Validation result when no ExperimentResult is available for the experiment. */
  private noResultValidation(
    targetStage: PromotionStage,
    experimentId: string,
  ): StageValidationResult {
    this.logger.warn(
      `Experiment ${experimentId} has no result — metric-based validation skipped for ${targetStage}`,
      this.context,
    );
    return {
      stage: targetStage,
      passed: true,
      metrics: {},
      notes: 'No result available — metric validation skipped',
      validatedAt: new Date(),
    };
  }

  // ── Stage Order Enforcement ───────────────────────────────────────────────

  /**
   * Validates that the target stage is the direct next stage after the current one.
   * Skipping stages (e.g. RESEARCH → WALK_FORWARD) is never allowed.
   */
  private assertValidTargetStage(
    currentStage: PromotionStage,
    targetStage: PromotionStage,
    experimentId: string,
  ): void {
    const currentOrder = PROMOTION_STAGE_ORDER[currentStage];
    const targetOrder = PROMOTION_STAGE_ORDER[targetStage];

    // Cannot promote if already at a terminal stage
    if (currentStage === PromotionStage.PRODUCTION || currentStage === PromotionStage.REJECTED) {
      throw new ResearchInvalidPromotionStageError(
        experimentId,
        `Experiment is already at terminal stage ${currentStage}`,
      );
    }

    // Cannot target the same stage or go backward (unless rejecting)
    if (targetStage !== PromotionStage.REJECTED && targetOrder <= currentOrder) {
      throw new ResearchInvalidPromotionStageError(
        experimentId,
        `Target stage ${targetStage} (order=${targetOrder}) is not ahead of ` +
          `current stage ${currentStage} (order=${currentOrder})`,
      );
    }

    // Enforce sequential pipeline — no skipping allowed
    if (targetStage !== PromotionStage.REJECTED) {
      const expectedNext = this.getNextStage(currentStage);
      if (expectedNext !== targetStage) {
        throw new ResearchPromotionStageMissingError(
          experimentId,
          currentStage,
          targetStage,
          expectedNext ?? 'none',
        );
      }
    }
  }

  /**
   * Validates the production approval token.
   * Token must be `APPROVE-PRODUCTION-{experimentId}`.
   */
  private assertProductionApprovalToken(request: PromotionRequest, experimentId: string): void {
    const expected = `${PRODUCTION_APPROVAL_TOKEN_PREFIX}${experimentId}`;
    if (request.productionApprovalToken !== expected) {
      throw new ResearchProductionContaminationError(
        `Production deployment of experiment ${experimentId} requires ` +
          `productionApprovalToken="${expected}". ` +
          `Received: "${request.productionApprovalToken ?? 'undefined'}". ` +
          `This two-step confirmation prevents accidental live deployment.`,
      );
    }
  }
}
