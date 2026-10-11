/**
 * Cluster DI tokens.
 *
 * Cluster services are optional (cluster.enabled=false = noop). Business
 * modules that need cluster awareness should inject via these tokens so that
 * the binding can be swapped to a no-op in single-node deployments without
 * changing any caller code.
 */
export const CLUSTER_TOKENS = {
  WORKER_ID_SERVICE: Symbol('ClusterWorkerIdService'),
  WORKER_REGISTRY: Symbol('ClusterWorkerRegistry'),
  HEARTBEAT_SERVICE: Symbol('ClusterHeartbeatService'),
  WORKER_DISCOVERY: Symbol('ClusterWorkerDiscovery'),
  LEADER_ELECTION: Symbol('ClusterLeaderElection'),
  TASK_ROUTER: Symbol('ClusterTaskRouter'),
  CLUSTER_HEALTH: Symbol('ClusterHealth'),
  CLUSTER_METRICS: Symbol('ClusterMetrics'),
} as const;
