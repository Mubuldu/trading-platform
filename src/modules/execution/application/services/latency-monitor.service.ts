import { Injectable } from '@nestjs/common';
import { LatencySample } from '../../domain/models/latency-sample.model';

export interface LatencyTracker {
  markValidation(): void;
  markBuild(): void;
  markRoute(): void;
  markExchangeRequest(): void;
  markExchangeResponse(): void;
  markFillProcessing(): void;
  sample(): LatencySample;
}

@Injectable()
export class LatencyMonitorService {
  start(): LatencyTracker {
    const origin = Date.now();
    let validationEnd = origin;
    let buildEnd = origin;
    let routeEnd = origin;
    let exchangeRequestEnd = origin;
    let exchangeResponseEnd = origin;
    let fillEnd = origin;

    return {
      markValidation: (): void => {
        validationEnd = Date.now();
      },
      markBuild: (): void => {
        buildEnd = Date.now();
      },
      markRoute: (): void => {
        routeEnd = Date.now();
      },
      markExchangeRequest: (): void => {
        exchangeRequestEnd = Date.now();
      },
      markExchangeResponse: (): void => {
        exchangeResponseEnd = Date.now();
      },
      markFillProcessing: (): void => {
        fillEnd = Date.now();
      },
      sample: (): LatencySample => ({
        validationTimeMs: validationEnd - origin,
        buildTimeMs: buildEnd - validationEnd,
        routingTimeMs: routeEnd - buildEnd,
        exchangeRequestTimeMs: exchangeRequestEnd - routeEnd,
        exchangeResponseTimeMs: exchangeResponseEnd - exchangeRequestEnd,
        fillProcessingTimeMs: fillEnd - exchangeResponseEnd,
        totalTimeMs: fillEnd - origin,
      }),
    };
  }
}
