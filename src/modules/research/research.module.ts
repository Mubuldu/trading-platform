import { Module } from '@nestjs/common';
import { BacktestModule } from '@modules/backtest/backtest.module';

// Storage
import { ExperimentStorageService } from './storage/experiment-storage.service';

// Application — Services
import { PythonBridgeService } from './application/services/python-bridge.service';
import { OnnxInferenceService } from './application/services/onnx-inference.service';
import { FeatureEngineeringService } from './application/services/feature-engineering.service';
import { FactorModelService } from './application/services/factor-model.service';
import { MarketRegimeDetectorService } from './application/services/market-regime-detector.service';
import { ResearchDataService } from './application/services/research-data.service';
import { ExperimentTrackerService } from './application/services/experiment-tracker.service';
import { ExperimentRunnerService } from './application/services/experiment-runner.service';

// Application — Reporters
import { ResearchReportService } from './application/reporters/research-report.service';

// Promotion
import { PromotionPipelineService } from './promotion/promotion-pipeline.service';

/**
 * ResearchModule — isolated quant research sandbox.
 *
 * ISOLATION CONTRACT:
 *   This module imports BacktestModule only for read-only historical data
 *   access (HistoricalLoaderFactoryService).  It NEVER imports:
 *     - ExecutionModule   — no order submission
 *     - RiskModule        — no production risk gate
 *     - OrderModule       — no order management
 *     - PortfolioModule   — no live portfolio state
 *
 *   Any service that attempts to interact with production systems will
 *   throw ResearchProductionContaminationError to enforce the boundary.
 *
 * Exports:
 *   ExperimentTrackerService   — lifecycle management (create/query experiments)
 *   ExperimentRunnerService    — run an experiment end-to-end
 *   ResearchReportService      — generate comparison reports
 *   PromotionPipelineService   — advance experiments through the pipeline
 *   ResearchDataService        — read-only market data access for research
 *   FeatureEngineeringService  — feature matrix construction
 *   FactorModelService         — factor exposure decomposition
 *   MarketRegimeDetectorService — market regime classification
 */
@Module({
  imports: [
    // Historical data loader — read-only; no writes to production data stores.
    BacktestModule,
  ],
  providers: [
    // ── Storage ──────────────────────────────────────────────────────────────
    ExperimentStorageService,

    // ── ML / Inference backends ──────────────────────────────────────────────
    PythonBridgeService,
    OnnxInferenceService,

    // ── Research analysis services ────────────────────────────────────────────
    FeatureEngineeringService,
    FactorModelService,
    MarketRegimeDetectorService,
    ResearchDataService,

    // ── Experiment lifecycle ─────────────────────────────────────────────────
    ExperimentTrackerService,
    ExperimentRunnerService,

    // ── Reports ──────────────────────────────────────────────────────────────
    ResearchReportService,

    // ── Promotion pipeline ────────────────────────────────────────────────────
    PromotionPipelineService,
  ],
  exports: [
    ExperimentTrackerService,
    ExperimentRunnerService,
    ResearchReportService,
    PromotionPipelineService,
    ResearchDataService,
    FeatureEngineeringService,
    FactorModelService,
    MarketRegimeDetectorService,
  ],
})
export class ResearchModule {}
