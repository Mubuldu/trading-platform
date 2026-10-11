import { Module } from '@nestjs/common';
import { GridSearchService } from './application/grid-search.service';
import { RandomSearchService } from './application/random-search.service';
import { SensitivityAnalyzerService } from './application/sensitivity-analyzer.service';
import { HeatmapGeneratorService } from './application/heatmap-generator.service';
import { ProbabilisticSharpeService } from './application/probabilistic-sharpe.service';
import { DeflatedSharpeService } from './application/deflated-sharpe.service';
import { PurgedCrossValidationService } from './application/purged-cross-validation.service';
import { CombinatorialPurgedCvService } from './application/combinatorial-purged-cv.service';
import { ParameterRegionDetectorService } from './application/parameter-region-detector.service';
import { StrategyHealthScorerService } from './application/strategy-health-scorer.service';
import { OverfittingDetectorService } from './application/overfitting-detector.service';

/**
 * ParameterStabilityModule
 *
 * Provides the full parameter-stability and overfitting-detection pipeline.
 *
 * Consumers inject `OverfittingDetectorService` and call `.analyze({
 *   sweepResults,   // pre-run grid/random-search backtest metrics
 *   bestReturns,    // return series of the winning combination
 * })`.
 *
 * Individual services are also exported for granular use:
 *   – GridSearchService / RandomSearchService          parameter enumeration
 *   – SensitivityAnalyzerService                       marginal sensitivity curves
 *   – HeatmapGeneratorService                          2-D metric heatmaps
 *   – ProbabilisticSharpeService / DeflatedSharpeService  statistical tests
 *   – PurgedCrossValidationService                     purged K-fold splits
 *   – CombinatorialPurgedCvService                     CPCV splits
 *   – ParameterRegionDetectorService                   cliff/island/stable detection
 *   – StrategyHealthScorerService                      A+ … F grading
 *
 * No external NestJS modules are required — the entire pipeline is pure math.
 */
@Module({
  providers: [
    GridSearchService,
    RandomSearchService,
    SensitivityAnalyzerService,
    HeatmapGeneratorService,
    ProbabilisticSharpeService,
    DeflatedSharpeService,
    PurgedCrossValidationService,
    CombinatorialPurgedCvService,
    ParameterRegionDetectorService,
    StrategyHealthScorerService,
    OverfittingDetectorService,
  ],
  exports: [
    GridSearchService,
    RandomSearchService,
    SensitivityAnalyzerService,
    HeatmapGeneratorService,
    ProbabilisticSharpeService,
    DeflatedSharpeService,
    PurgedCrossValidationService,
    CombinatorialPurgedCvService,
    ParameterRegionDetectorService,
    StrategyHealthScorerService,
    OverfittingDetectorService,
  ],
})
export class ParameterStabilityModule {}
