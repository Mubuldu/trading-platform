import { Global, Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import { LifecycleManager } from '@infrastructure/lifecycle/lifecycle.manager';
import { ServiceRegistry } from '@infrastructure/lifecycle/service-registry';
import { WorkerStatus } from './identity/worker-identity';

// Services
import { WorkerIdService } from './identity/worker-id.service';
import { WorkerRegistryService } from './registry/worker-registry.service';
import { HeartbeatService } from './heartbeat/heartbeat.service';
import { WorkerDiscoveryService } from './discovery/worker-discovery.service';
import { LeaderElectionService } from './leader/leader-election.service';
import { RoundRobinBalancer } from './task-distribution/round-robin.balancer';
import { LeastLoadedBalancer } from './task-distribution/least-loaded.balancer';
import { StickyBalancer } from './task-distribution/sticky.balancer';
import { WeightedBalancer } from './task-distribution/weighted.balancer';
import { TaskRouterService } from './task-distribution/task-router.service';
import { ClusterHealthService } from './health/cluster-health.service';
import { ClusterMetricsService } from './metrics/cluster-metrics.service';

/**
 * ClusterModule wires the complete horizontal-scaling infrastructure.
 *
 * When CLUSTER_ENABLED=false (default) all cluster services are instantiated
 * but operate in no-op mode: the single local worker registers itself as the
 * only cluster member, the task router always routes to itself, and leader
 * election immediately wins. Business code is completely unaware of the mode.
 *
 * When CLUSTER_ENABLED=true all services activate and coordinate via Redis.
 *
 * Module is @Global() so cluster services are injectable everywhere without
 * re-importing ClusterModule. This mirrors the pattern used by InfrastructureModule.
 *
 * Startup sequence (via LifecycleManager, priority=80):
 *   1. Register local worker in Redis
 *   2. Start heartbeat loop
 *   3. Start leader election loop
 *   4. Start metrics publisher
 *   5. Register cluster health check
 *
 * Shutdown sequence (reverse):
 *   1. Deregister local worker (marks self offline)
 *   2. HeartbeatService.onModuleDestroy clears heartbeat key
 *   3. LeaderElectionService.onModuleDestroy releases leader key
 *   4. ClusterMetricsService.onModuleDestroy removes metrics key
 */
@Global()
@Module({
  providers: [
    WorkerIdService,
    WorkerRegistryService,
    HeartbeatService,
    WorkerDiscoveryService,
    LeaderElectionService,
    RoundRobinBalancer,
    LeastLoadedBalancer,
    StickyBalancer,
    WeightedBalancer,
    TaskRouterService,
    ClusterHealthService,
    ClusterMetricsService,
  ],
  exports: [
    WorkerIdService,
    WorkerRegistryService,
    HeartbeatService,
    WorkerDiscoveryService,
    LeaderElectionService,
    TaskRouterService,
    ClusterHealthService,
    ClusterMetricsService,
    // Export balancers so they can be injected individually for testing
    RoundRobinBalancer,
    LeastLoadedBalancer,
    StickyBalancer,
    WeightedBalancer,
  ],
})
export class ClusterModule implements OnModuleInit, OnModuleDestroy {
  private readonly context = ClusterModule.name;
  private readonly config: ClusterConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly workerIdService: WorkerIdService,
    private readonly workerRegistry: WorkerRegistryService,
    private readonly heartbeat: HeartbeatService,
    private readonly leaderElection: LeaderElectionService,
    private readonly clusterHealth: ClusterHealthService,
    private readonly clusterMetrics: ClusterMetricsService,
    private readonly healthRegistry: HealthCheckRegistry,
    private readonly lifecycleManager: LifecycleManager,
    private readonly serviceRegistry: ServiceRegistry,
    private readonly logger: AppLoggerService,
  ) {
    this.config = this.configService.get<ClusterConfig>('cluster')!;
  }

  onModuleInit(): void {
    // Register cluster health check with global health registry
    this.healthRegistry.register({
      name: 'cluster',
      check: () => this.clusterHealth.getHealth(),
    });

    // Register with lifecycle manager — priority 80 (after Redis at 90,
    // before application logic at lower priorities)
    this.lifecycleManager.register({
      serviceName: 'cluster',
      priority: 80,
      onStart: async () => {
        await this.startCluster();
        this.serviceRegistry.register({
          name: 'cluster',
          version: '1.0.0',
          capabilities: this.workerIdService.info.capabilities,
          startedAt: new Date(),
          status: 'healthy',
        });
      },
      onStop: async () => {
        await this.stopCluster();
        this.serviceRegistry.updateStatus('cluster', 'stopped');
      },
    });

    this.logger.log(
      `ClusterModule initialized — mode=${this.config.enabled ? 'cluster' : 'single-node'}`,
      this.context,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // HeartbeatService, LeaderElectionService, ClusterMetricsService each
    // implement OnModuleDestroy and clean up themselves.
  }

  private async startCluster(): Promise<void> {
    const info = this.workerIdService.info;
    this.workerIdService.updateStatus(WorkerStatus.ACTIVE);

    // Register this worker in Redis
    await this.workerRegistry.register({
      ...info,
      status: WorkerStatus.ACTIVE,
    });

    // Start liveness signalling
    this.heartbeat.start();

    // Start leader election (all nodes participate; one wins)
    this.leaderElection.start();

    // Start resource metrics publishing
    this.clusterMetrics.start();

    this.logger.log(
      `Cluster node online — nodeId=${info.nodeId}, ` +
        `capabilities=[${info.capabilities.join(',')}], ` +
        `mode=${this.config.enabled ? 'cluster' : 'single-node'}`,
      this.context,
    );
  }

  private async stopCluster(): Promise<void> {
    this.workerIdService.updateStatus(WorkerStatus.STOPPING);
    try {
      await this.workerRegistry.deregister(this.workerIdService.nodeId);
    } catch {
      // Best-effort
    }
    this.logger.log('Cluster node offline', this.context);
  }
}
