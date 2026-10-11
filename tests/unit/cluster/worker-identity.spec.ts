import {
  WorkerCapability,
  WorkerStatus,
  serializeWorkerInfo,
  deserializeWorkerInfo,
  WorkerInfo,
} from '@infrastructure/cluster/identity/worker-identity';

function makeInfo(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    nodeId: 'node-1',
    nodeLabel: 'node-1',
    hostname: 'host-a',
    pid: 9999,
    capabilities: [WorkerCapability.INDICATOR, WorkerCapability.STRATEGY],
    status: WorkerStatus.ACTIVE,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastHeartbeatAt: '2026-01-01T00:01:00.000Z',
    cpuPercent: 42.5,
    memoryBytes: 1_073_741_824,
    activeTaskCount: 7,
    ...overrides,
  };
}

describe('WorkerIdentity serialization', () => {
  it('serializes all fields to strings', () => {
    const info = makeInfo();
    const snap = serializeWorkerInfo(info);

    expect(typeof snap.pid).toBe('string');
    expect(typeof snap.cpuPercent).toBe('string');
    expect(typeof snap.memoryBytes).toBe('string');
    expect(typeof snap.activeTaskCount).toBe('string');
    expect(typeof snap.capabilities).toBe('string');
  });

  it('round-trips without data loss', () => {
    const info = makeInfo();
    const snap = serializeWorkerInfo(info);
    const restored = deserializeWorkerInfo(snap);

    expect(restored.nodeId).toBe(info.nodeId);
    expect(restored.hostname).toBe(info.hostname);
    expect(restored.pid).toBe(info.pid);
    expect(restored.status).toBe(info.status);
    expect(restored.cpuPercent).toBeCloseTo(info.cpuPercent);
    expect(restored.memoryBytes).toBe(info.memoryBytes);
    expect(restored.activeTaskCount).toBe(info.activeTaskCount);
    expect(restored.capabilities).toEqual(info.capabilities);
  });

  it('deserializes with safe defaults when fields are missing', () => {
    const partial: Record<string, string> = { nodeId: 'x' };
    const restored = deserializeWorkerInfo(partial);
    expect(restored.pid).toBe(0);
    expect(restored.cpuPercent).toBe(0);
    expect(restored.memoryBytes).toBe(0);
    expect(restored.activeTaskCount).toBe(0);
    expect(restored.capabilities).toEqual([]);
    expect(restored.status).toBe(WorkerStatus.OFFLINE);
  });

  it('serializes empty capabilities array', () => {
    const info = makeInfo({ capabilities: [] });
    const snap = serializeWorkerInfo(info);
    expect(snap.capabilities).toBe('[]');
    const restored = deserializeWorkerInfo(snap);
    expect(restored.capabilities).toEqual([]);
  });

  it('serializes all WorkerCapability values without loss', () => {
    const allCaps = Object.values(WorkerCapability);
    const info = makeInfo({ capabilities: allCaps });
    const snap = serializeWorkerInfo(info);
    const restored = deserializeWorkerInfo(snap);
    expect(restored.capabilities).toEqual(allCaps);
  });
});
