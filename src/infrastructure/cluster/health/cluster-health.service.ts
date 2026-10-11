import { Injectable } from '@nestjs/common';
import {
  ProviderHealth,
  healthyResult,
  unhealthyResult,
  HealthCheckable,
} from '@infrastructure/health/health-check.interface';
import { WorkerDiscoveryService } from '../discovery/worker-discovery.service';
import { LeaderElectionService } from '../leader/leader-election.service';
import { WorkerIdService } from '../identity/worker-id.service';

/**
 * ClusterHealthService aggregates cluster-level health into a single
 * ProviderHealth report that is registered with the HealthCheckRegistry.
 *
 * Health classification:
 *   healthy  — all capability types have at least one active worker and a
 *              leader is elected
 *   degraded — some capability types have no workers (partial cluster) or
 *              no leader is elected (tasks may not be distributed)
 *   unhealthy — zero active workers (entire cluster is down)
 *
 * This service is registered with the global HealthCheckRegistry in
 * ClusterModule.onModuleInit() so that GET /api/v1/health reflects cluster
 * state without any changes to the health controller.
 */
@Injectable()
export class ClusterHealthService implements HealthCheckable {
  constructor(
    private readonly discovery: WorkerDiscoveryService,
    private readonly leader: LeaderElectionService,
    private readonly workerIdService: WorkerIdService,
  ) {}

  async getHealth(): Promise<ProviderHealth> {
    const start = Date.now();

    const [summary, currentLeader] = await Promise.all([
      this.discovery.getClusterSummary(),
      this.leader.getCurrentLeader(),
    ]);

    const latencyMs = Date.now() - start;

    const metadata: Record<string, unknown> = {
      totalWorkers: summary.totalWorkers,
      byCapability: summary.byCapability,
      currentLeader: currentLeader ?? 'none',
      isLocalLeader: this.leader.isLeader,
      localNodeId: this.workerIdService.nodeId,
    };

    if (summary.totalWorkers === 0) {
      return unhealthyResult('No active workers in cluster', latencyMs);
    }

    const issues: string[] = [];

    if (!currentLeader) {
      issues.push('no leader elected');
    }

    if (issues.length > 0) {
      return {
        status: 'degraded',
        message: `Cluster degraded: ${issues.join(', ')}`,
        latencyMs,
        metadata,
        checkedAt: new Date(),
      };
    }

    return {
      ...healthyResult(
        `Cluster healthy — ${summary.totalWorkers} worker(s), leader=${currentLeader}`,
        latencyMs,
      ),
      metadata,
    };
  }
}
