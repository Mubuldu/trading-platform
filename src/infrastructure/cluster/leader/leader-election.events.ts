/**
 * Events emitted by LeaderElectionService via Node.js EventEmitter.
 *
 * Consumers should listen to these events rather than polling isLeader()
 * so they react immediately to leadership changes without polling overhead.
 *
 * Usage:
 *   leaderElection.on('leadership:gained', ({ nodeId }) => { ... });
 *   leaderElection.on('leadership:lost',   ({ nodeId }) => { ... });
 */
export const LEADER_ELECTION_EVENTS = {
  GAINED: 'leadership:gained',
  LOST: 'leadership:lost',
  RENEWED: 'leadership:renewed',
} as const;

export interface LeadershipGainedPayload {
  readonly nodeId: string;
  readonly gainedAt: Date;
}

export interface LeadershipLostPayload {
  readonly nodeId: string;
  readonly lostAt: Date;
  readonly reason: 'renewal_failed' | 'explicit_release' | 'shutdown';
}

export interface LeadershipRenewedPayload {
  readonly nodeId: string;
  readonly renewedAt: Date;
  readonly leaseTtlMs: number;
}
