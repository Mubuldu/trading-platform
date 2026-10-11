import { randomUUID } from 'crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { StrategyRegistryService } from '@modules/strategy/registry/strategy-registry.service';
import { BacktestConfig } from '../../domain/models/backtest-config.model';
import { BacktestResult } from '../../domain/models/backtest-result.model';
import { OptimizationConfig } from '../../domain/models/optimization-config.model';
import { OptimizationJobStatus, OptimizationResult } from '../../domain/models/optimization-result.model';
import { BacktestEngineService } from '../engine/backtest-engine.service';
import { BacktestHistoryService } from '../services/backtest-history.service';
import { BacktestOptimizerService } from '../services/backtest-optimizer.service';

/**
 * BacktestController exposes the backtesting and parameter optimization engine over HTTP.
 *
 * All routes are protected by the x-api-key header (ApiKeyGuard).
 * Base path (via global prefix): /api/v1/backtest
 *
 * ─── Backtesting ──────────────────────────────────────────────────────────
 * POST /run         — Execute a single backtest (synchronous, 10–60 s).
 * GET  /history     — Return the last N completed backtest results from Redis.
 * GET  /ping        — Liveness probe.
 *
 * ─── Parameter Optimization ───────────────────────────────────────────────
 * POST /optimize           — Start an async walk-forward grid search; returns { jobId }.
 * GET  /optimize/:jobId    — Poll job progress and retrieve the final result.
 * POST /optimize/:jobId/apply — Apply the validated best config to the live strategy.
 *                              Explicit caller action required — never auto-applied.
 */
@ApiTags('Backtest')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('backtest')
export class BacktestController {
  constructor(
    private readonly engine: BacktestEngineService,
    private readonly history: BacktestHistoryService,
    private readonly optimizer: BacktestOptimizerService,
    private readonly strategyRegistry: StrategyRegistryService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // POST /backtest/run
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run a backtest simulation.
   *
   * The request body follows the BacktestConfig schema. `sessionId` is
   * auto-generated server-side and overwrites any client-supplied value.
   *
   * Response includes the full PerformanceReport with equity curve and trade list.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a backtest', description: 'Synchronous; expect 10–60 s for multi-year ranges.' })
  @ApiBody({ description: 'Backtest configuration (sessionId is auto-generated)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Full BacktestResult' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid x-api-key' })
  async run(@Body() body: Omit<BacktestConfig, 'sessionId'>): Promise<BacktestResult> {
    const config: BacktestConfig = { ...(body as BacktestConfig), sessionId: randomUUID() };
    const result = await this.engine.run(config);
    await this.history.saveResult(result);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /backtest/history
  // ─────────────────────────────────────────────────────────────────────────

  @Get('history')
  @ApiOperation({ summary: 'Get backtest history', description: 'Most recent results, newest first (max 20).' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–20, default 20' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Array of BacktestResult' })
  async getHistory(@Query('limit') limitParam?: string): Promise<BacktestResult[]> {
    return this.history.getHistory(this.parseLimit(limitParam));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /backtest/ping
  // ─────────────────────────────────────────────────────────────────────────

  @Get('ping')
  @ApiOperation({ summary: 'Liveness probe' })
  ping(): { status: string; ts: number } {
    return { status: 'pong', ts: Date.now() };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /backtest/optimize
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start an async walk-forward parameter optimization.
   *
   * The optimizer expands the `parameterGrid` into all valid combinations,
   * runs every combo on the train period, ranks by `rankBy` (default: Sharpe),
   * then validates the top-N on the held-out test period. Returns a `jobId`
   * immediately — poll `GET /backtest/optimize/:jobId` for progress.
   *
   * ## Walk-forward split guarantee
   * The test period is never touched during training. Optimizing on it even
   * once contaminates it — use a separate validation set if you need to tune
   * thresholds after seeing test results.
   *
   * ## Timing
   * 54 combos × 5 s each ≈ 4.5 min. For smaller grids or shorter date ranges
   * this is significantly faster. Binance data is disk-cached after the first run.
   */
  @Post('optimize')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start parameter optimization',
    description:
      'Async walk-forward grid search over TrendFollowingV1 params. ' +
      'Returns { jobId } immediately. Poll GET /optimize/:jobId for status.',
  })
  @ApiBody({ description: 'OptimizationConfig with parameterGrid and walk-forward split' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: '{ jobId: string }' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid x-api-key' })
  async startOptimize(
    @Body() config: OptimizationConfig,
  ): Promise<{ jobId: string; message: string; totalCombinations: number }> {
    const combos = this.optimizer.expandGrid(config.parameterGrid);
    const jobId = await this.optimizer.startJob(config);
    return {
      jobId,
      message: `Optimization started — ${combos.length} valid combos. Poll GET /backtest/optimize/${jobId} for progress.`,
      totalCombinations: combos.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /backtest/optimize/:jobId
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Poll optimization job progress.
   *
   * Returns the full `OptimizationJobStatus` including live progress counters
   * and, once the job completes, the embedded `OptimizationResult`.
   *
   * `status` field:
   *   RUNNING   — combos still being evaluated; check `progress.pct` for completion %
   *   COMPLETED — `result` is populated; inspect `result.bestValidatedConfig`
   *   FAILED    — `error` explains what went wrong
   */
  @Get('optimize/:jobId')
  @ApiOperation({ summary: 'Poll optimization job status' })
  @ApiParam({ name: 'jobId', description: 'Job ID returned by POST /optimize' })
  @ApiResponse({ status: HttpStatus.OK, description: 'OptimizationJobStatus with optional embedded result' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Job not found (expired or invalid ID)' })
  async getOptimizeStatus(@Param('jobId') jobId: string): Promise<OptimizationJobStatus> {
    const status = await this.optimizer.getJobStatus(jobId);
    if (!status) {
      throw new NotFoundException(`Optimization job "${jobId}" not found. Jobs expire after 24 h.`);
    }
    return status;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /backtest/optimize/:jobId/apply
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Apply the validated best configuration to the live strategy.
   *
   * This is always an explicit caller action — the optimizer never auto-applies.
   * Only proceeds when the job is COMPLETED and `bestValidatedConfig` is present
   * (i.e. at least one combo passed the acceptance thresholds on the test period).
   *
   * The `targetStrategyId` query param identifies which live strategy instance to
   * update. Defaults to `"trend-following-v1"`.
   *
   * The live strategy's `loadConfiguration()` is called with the new params —
   * it takes effect on the next candle without restarting the process.
   */
  @Post('optimize/:jobId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply validated best config to live strategy',
    description:
      'Caller must explicitly request this — the optimizer never auto-applies. ' +
      'Requires the job to be COMPLETED with a bestValidatedConfig present.',
  })
  @ApiParam({ name: 'jobId', description: 'Completed optimization job ID' })
  @ApiQuery({
    name: 'targetStrategyId',
    required: false,
    description: 'Live strategy ID to update (default: "trend-following-v1")',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Config applied successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Job or strategy not found' })
  async applyOptimizedConfig(
    @Param('jobId') jobId: string,
    @Query('targetStrategyId') targetStrategyId?: string,
  ): Promise<{ applied: boolean; strategyId: string; message: string }> {
    const jobStatus = await this.optimizer.getJobStatus(jobId);
    if (!jobStatus) {
      throw new NotFoundException(`Optimization job "${jobId}" not found.`);
    }

    const result: OptimizationResult | undefined = jobStatus.result;

    if (!result || jobStatus.status !== 'COMPLETED') {
      throw new NotFoundException(`Job "${jobId}" is not yet completed (status: ${jobStatus.status}).`);
    }

    if (!result.bestValidatedConfig) {
      throw new NotFoundException(
        `Job "${jobId}" has no validated config — no combo passed acceptance thresholds on the test period. ` +
          'Review result.warnings for details.',
      );
    }

    const stratId = targetStrategyId ?? 'trend-following-v1';
    const reloadResult = await this.strategyRegistry.reload(stratId, result.bestValidatedConfig);

    if (reloadResult.isErr()) {
      throw new NotFoundException(
        `Strategy "${stratId}" not found in registry. ` +
          'Ensure the live strategy is initialised before applying optimizer output.',
      );
    }

    return {
      applied: true,
      strategyId: stratId,
      message: `Best validated config applied to strategy "${stratId}". New params take effect on the next candle.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private parseLimit(raw: string | undefined): number {
    if (!raw) return 20;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 20;
    return Math.min(n, 20);
  }
}
