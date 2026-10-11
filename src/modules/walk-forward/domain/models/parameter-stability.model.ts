export interface ParameterStabilityMetric {
  readonly paramName: string;
  readonly values: number[];
  readonly mean: number;
  readonly stdDev: number;
  readonly coefficientOfVariation: number;
  readonly isStable: boolean;
  readonly isSensitive: boolean;
  readonly isFragile: boolean;
}

export interface ParameterStabilityReport {
  readonly parameters: Record<string, ParameterStabilityMetric>;
  readonly overallStabilityScore: number;
}
