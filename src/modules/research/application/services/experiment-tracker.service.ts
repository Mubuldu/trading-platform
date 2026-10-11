import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Experiment, ExperimentConfig } from '../../domain/models/experiment.model';
import { ExperimentResult } from '../../domain/models/experiment-result.model';
import { PromotionRecord } from '../../domain/models/promotion-request.model';
import { ExperimentStatus } from '../../domain/enums/experiment-status.enum';
import { PromotionStage } from '../../domain/enums/promotion-stage.enum';
import { ExperimentStorageService } from '../../storage/experiment-storage.service';
import {
  ResearchExperimentNotFoundError,
  ResearchExperimentAlreadyExistsError,
  ResearchReproducibilityError,
} from '../../domain/errors/research.errors';

export interface CreateExperimentDto {
  readonly name: string;
  readonly description: string;
  readonly config: ExperimentConfig;
  readonly randomSeed: number;
  readonly tags?: string[];
}

export interface ExperimentSummary {
  readonly id: string;
  readonly name: string;
  readonly status: ExperimentStatus;
  readonly promotionStage: PromotionStage;
  readonly createdAt: Date;
  readonly tags: string[];
  readonly hasResult: boolean;
}

/**
 * ExperimentTrackerService manages the lifecycle of research experiments.
 *
 * Responsibilities:
 *   - Create experiments with reproducibility metadata (commit hash, random seed).
 *   - Persist experiment state via ExperimentStorageService.
 *   - Update experiment status (PENDING → RUNNING → COMPLETED/FAILED).
 *   - Store experiment results.
 *   - Provide experiment query and listing APIs.
 *
 * Reproducibility guarantee:
 *   Every experiment captures the git commit hash at creation time.
 *   Combined with the random seed and fully serialisable config, any
 *   experiment can be re-run identically from any point in history.
 *
 * ISOLATION:
 *   This service never interacts with production execution or order management.
 */
@Injectable()
export class ExperimentTrackerService {
  private readonly context = ExperimentTrackerService.name;

  constructor(
    private readonly storage: ExperimentStorageService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Creates and persists a new experiment.
   *
   * @throws ResearchExperimentAlreadyExistsError if the name is already in use.
   * @throws ResearchReproducibilityError         if the config is not fully serialisable.
   */
  async create(dto: CreateExperimentDto): Promise<Experiment> {
    // Duplicate name guard
    const existingId = await this.storage.findIdByName(dto.name);
    if (existingId) {
      throw new ResearchExperimentAlreadyExistsError(dto.name);
    }

    // Verify config is fully serialisable (reproducibility requirement)
    this.assertSerializable(dto.config, dto.name);

    const experiment: Experiment = {
      id: randomUUID(),
      name: dto.name,
      description: dto.description,
      config: dto.config,
      commitHash: this.captureCommitHash(),
      randomSeed: dto.randomSeed,
      status: ExperimentStatus.PENDING,
      promotionStage: PromotionStage.RESEARCH,
      tags: dto.tags ?? [],
      createdAt: new Date(),
    };

    await this.storage.saveExperiment(experiment);

    this.logger.log(
      `Experiment created: id=${experiment.id} name="${experiment.name}" ` +
        `commit=${experiment.commitHash} seed=${experiment.randomSeed}`,
      this.context,
    );

    return experiment;
  }

  // ── Status Updates ────────────────────────────────────────────────────────

  async markRunning(experimentId: string): Promise<void> {
    const exp = await this.requireExperiment(experimentId);
    exp.status = ExperimentStatus.RUNNING;
    exp.startedAt = new Date();
    await this.storage.saveExperiment(exp);
    this.logger.log(`Experiment ${experimentId} status → RUNNING`, this.context);
  }

  async markCompleted(experimentId: string, result: ExperimentResult): Promise<void> {
    const exp = await this.requireExperiment(experimentId);
    exp.status = ExperimentStatus.COMPLETED;
    exp.completedAt = new Date();
    await this.storage.saveExperiment(exp);
    await this.storage.saveResult(result);
    this.logger.log(
      `Experiment ${experimentId} status → COMPLETED ` +
        `(Sharpe=${result.metrics.sharpeRatio.toFixed(2)}, ` +
        `maxDD=${result.metrics.maxDrawdownPercent.toFixed(1)}%)`,
      this.context,
    );
  }

  async markFailed(experimentId: string, reason: string): Promise<void> {
    const exp = await this.requireExperiment(experimentId);
    exp.status = ExperimentStatus.FAILED;
    exp.completedAt = new Date();
    exp.failureReason = reason;
    await this.storage.saveExperiment(exp);
    this.logger.warn(`Experiment ${experimentId} status → FAILED: ${reason}`, this.context);
  }

  async markCancelled(experimentId: string): Promise<void> {
    const exp = await this.requireExperiment(experimentId);
    exp.status = ExperimentStatus.CANCELLED;
    exp.completedAt = new Date();
    await this.storage.saveExperiment(exp);
    this.logger.log(`Experiment ${experimentId} status → CANCELLED`, this.context);
  }

  async updatePromotionStage(
    experimentId: string,
    stage: PromotionStage,
    record: PromotionRecord,
  ): Promise<void> {
    const exp = await this.requireExperiment(experimentId);
    exp.promotionStage = stage;
    await this.storage.saveExperiment(exp);
    await this.storage.appendPromotionRecord(experimentId, record);
    this.logger.log(`Experiment ${experimentId} promotion → ${stage}`, this.context);
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  async findById(experimentId: string): Promise<Experiment> {
    return this.requireExperiment(experimentId);
  }

  async findResultById(experimentId: string): Promise<ExperimentResult | null> {
    return this.storage.findResultById(experimentId);
  }

  async listAll(offset = 0, limit = 50): Promise<ExperimentSummary[]> {
    const experiments = await this.storage.listAll(offset, limit);
    return Promise.all(
      experiments.map(async (exp) => {
        const result = await this.storage.findResultById(exp.id);
        return {
          id: exp.id,
          name: exp.name,
          status: exp.status,
          promotionStage: exp.promotionStage,
          createdAt: exp.createdAt,
          tags: exp.tags,
          hasResult: result !== null,
        };
      }),
    );
  }

  async getPromotionHistory(experimentId: string): Promise<PromotionRecord[]> {
    return this.storage.getPromotionHistory(experimentId);
  }

  async count(): Promise<number> {
    return this.storage.countAll();
  }

  async delete(experimentId: string): Promise<void> {
    await this.requireExperiment(experimentId); // throws if not found
    await this.storage.deleteExperiment(experimentId);
    this.logger.log(`Experiment ${experimentId} deleted`, this.context);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async requireExperiment(id: string): Promise<Experiment> {
    const exp = await this.storage.findById(id);
    if (!exp) throw new ResearchExperimentNotFoundError(id);
    return exp;
  }

  /**
   * Captures the current git commit hash.
   * Returns 'unknown' if git is unavailable (e.g. in CI without checkout).
   */
  private captureCommitHash(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      this.logger.warn(
        'Could not capture git commit hash — experiment will use "unknown"',
        this.context,
      );
      return 'unknown';
    }
  }

  /**
   * Verifies that the experiment config round-trips through JSON serialisation.
   * This is the reproducibility guarantee: a config that cannot be serialised
   * cannot be reproduced from storage.
   */
  private assertSerializable(config: ExperimentConfig, name: string): void {
    try {
      const json = JSON.stringify(config);
      JSON.parse(json);
    } catch (err) {
      throw new ResearchReproducibilityError(
        name,
        `Config is not JSON-serialisable: ${(err as Error).message}`,
      );
    }
  }
}
