import { LatencyMonitorService } from '../../../src/modules/execution/application/services/latency-monitor.service';

describe('LatencyMonitorService', () => {
  let service: LatencyMonitorService;

  beforeEach(() => {
    service = new LatencyMonitorService();
  });

  it('starts a tracker and returns a latency sample', () => {
    const tracker = service.start();
    tracker.markValidation();
    tracker.markBuild();
    tracker.markRoute();
    tracker.markExchangeRequest();
    tracker.markExchangeResponse();
    tracker.markFillProcessing();

    const sample = tracker.sample();
    expect(sample.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.validationTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.buildTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.routingTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.exchangeRequestTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.exchangeResponseTimeMs).toBeGreaterThanOrEqual(0);
    expect(sample.fillProcessingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('totalTimeMs is approximately sum of all phases', () => {
    const tracker = service.start();
    tracker.markValidation();
    tracker.markBuild();
    tracker.markRoute();
    tracker.markExchangeRequest();
    tracker.markExchangeResponse();
    tracker.markFillProcessing();

    const sample = tracker.sample();
    const sumOfPhases =
      sample.validationTimeMs +
      sample.buildTimeMs +
      sample.routingTimeMs +
      sample.exchangeRequestTimeMs +
      sample.exchangeResponseTimeMs +
      sample.fillProcessingTimeMs;

    expect(Math.abs(sample.totalTimeMs - sumOfPhases)).toBeLessThanOrEqual(5);
  });

  it('multiple trackers are independent', () => {
    const t1 = service.start();
    const t2 = service.start();
    t1.markValidation();
    t1.markBuild();
    t1.markRoute();
    t1.markExchangeRequest();
    t1.markExchangeResponse();
    t1.markFillProcessing();
    t2.markValidation();
    t2.markBuild();
    t2.markRoute();
    t2.markExchangeRequest();
    t2.markExchangeResponse();
    t2.markFillProcessing();

    const s1 = t1.sample();
    const s2 = t2.sample();
    expect(s1.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(s2.totalTimeMs).toBeGreaterThanOrEqual(0);
  });
});
