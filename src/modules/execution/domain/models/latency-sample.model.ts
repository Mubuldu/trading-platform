export interface LatencySample {
  readonly validationTimeMs: number;
  readonly buildTimeMs: number;
  readonly routingTimeMs: number;
  readonly exchangeRequestTimeMs: number;
  readonly exchangeResponseTimeMs: number;
  readonly fillProcessingTimeMs: number;
  readonly totalTimeMs: number;
}
