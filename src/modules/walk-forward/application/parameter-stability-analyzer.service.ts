import { Injectable } from '@nestjs/common';
import {
  ParameterStabilityMetric,
  ParameterStabilityReport,
} from '../domain/models/parameter-stability.model';
import { WalkForwardWindowResult } from '../domain/models/walk-forward-window-result.model';

@Injectable()
export class ParameterStabilityAnalyzerService {
  analyze(windowResults: WalkForwardWindowResult[]): ParameterStabilityReport {
    if (windowResults.length === 0) {
      return { parameters: {}, overallStabilityScore: 0 };
    }

    const paramNames = Object.keys(windowResults[0].bestParams);
    const paramMetrics: Record<string, ParameterStabilityMetric> = {};

    for (const paramName of paramNames) {
      const values = windowResults
        .map((w) => w.bestParams[paramName])
        .filter((v): v is number => v !== undefined);

      if (values.length === 0) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean !== 0 ? stdDev / Math.abs(mean) : stdDev > 0 ? Infinity : 0;

      paramMetrics[paramName] = {
        paramName,
        values,
        mean,
        stdDev,
        coefficientOfVariation: cv,
        isStable: cv < 0.3,
        isSensitive: cv >= 0.3 && cv < 0.5,
        isFragile: cv >= 0.5,
      };
    }

    const paramList = Object.values(paramMetrics);
    const stableCount = paramList.filter((p) => p.isStable).length;
    const overallStabilityScore = paramList.length > 0 ? stableCount / paramList.length : 1;

    return { parameters: paramMetrics, overallStabilityScore };
  }
}
