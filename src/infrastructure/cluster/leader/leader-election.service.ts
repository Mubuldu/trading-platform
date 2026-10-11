import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { WorkerIdService } from '../identity/worker-id.service';
import { HeartbeatService } from '../heartbeat/heartbeat.service';
import {
  LEADER_ELECTION_EVENTS,
  LeadershipGainedPayload,
  LeadershipLostPayload,
  LeadershipRenewedPayload,
} from './leader-election.events';

/**
 * LeaderElectionService implements a single-leader election via Redis
 * using the SET NX PX command (atomic "set if not exists with TTL").
 *
 * Algorithm (single-node Redlock-light):
 *   1. Attempt: SET cluster:leader <nodeId> NX PX leaderLeaseTtlMs
 *   2. If OK → this node is leader; start renewal loop and dead-worker scanner
 *   3. If not OK → another node holds the lease; retry on next election interval
 *   4. Leader renews via SET cluster:leader <nodeId> PX leaderLeaseTtlMs (no NX)
 *      guarded by Lua script that only overwrites if the value matches nodeId
 *   5. If renewal fails (Redis down, key hijacked) → emit leadership:lost
 *
 * Why single-node Redlock vs multi-node Redlock?
 * True Redlock requires N ≥ 3 independent Redis nodes for quorum. In a
 * single-datacenter deployment with a Redis Sentinel or Cluster setup there
 * is effectively one logical Redis instance. Multi-node Redlock adds
 * significant complexity (quorum writes, clock skew tolerance) without safety
 * benefit when all nodes share the same Redis infrastructure. For multi-DC
 * deployments, replace this service with a consensus system (etcd, Zookeeper)
 * or multi-node Redlock.
 *
 * Fencing token:
 * The nodeId embedded in the lease value acts as a fencing token. The Lua
 * renewal script atomically checks the current value before overwriting, so
 * a node that lost leadership cannot accidentally re-acquire it via a delayed
 * renewal write.
 */
@Injectable()
export class LeaderElectionService extends EventEmitter implements OnModuleDestroy {
  private readonly context = LeaderElectionService.name;

  private static readonly LEADER_KEY = 'cluster:leader';

  /** Lua script for fenced renewal: only update if current value matches nodeId */
  private static readonly RENEWAL_SCRIPT = `
    local current = redis.call('GET', KEYS[1])
    if current == ARGV[1] then
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  /** Lua script for fenced release: only DEL if current value matches nodeId */
  private static readonly RELEASE_SCRIPT = `
    local current = redis.call('GET', KEYS[1])
    if current == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    else
      return 0
    end
  `;

  private readonly config: ClusterConfig;

  private electionTimer: NodeJS.Timeout | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;
  private _isLeader = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisClientService,
    private readonly workerIdService: WorkerIdService,
    private readonly heartbeatService: HeartbeatService,
    private readonly logger: AppLoggerService,
  ) {
    super();
    this.config = this.configService.get<ClusterConfig>('cluster')!;
  }

  /** Start the election loop. Called by ClusterModule.onModuleInit(). */
  start(): void {
    // Attempt immediately, then on interval
    void this.attemptElection();

    // Re-attempt on an interval equal to the renewal interval so a follower
    // takes over promptly when the leader's lease expires.
    this.electionTimer = setInterval(
      () => void this.attemptElection(),
      this.config.leaderRenewalIntervalMs,
    );

    this.logger.log(
      `Leader election loop started — leaseTtl=${this.config.leaderLeaseTtlMs}ms, ` +
        `renewalInterval=${this.config.leaderRenewalIntervalMs}ms`,
      this.context,
    );
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  /**
   * Return the nodeId of the current leader, or null if no leader is elected.
   * This is a Redis read — call sparingly.
   */
  async getCurrentLeader(): Promise<string | null> {
    const client = this.redis.getClient();
    return client.get(LeaderElectionService.LEADER_KEY);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
      this.electionTimer = null;
    }
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }

    if (this._isLeader) {
      await this.releaseLeadership('shutdown');
    }
  }

  private async attemptElection(): Promise<void> {
    if (this._isLeader) {
      // Already leader — renewal is handled by the renewal timer
      return;
    }

    try {
      const client = this.redis.getClient();
      const nodeId = this.workerIdService.nodeId;

      // SET PX NX: set with millisecond TTL only if key does not exist.
      // ioredis 6.x positional overload requires PX <ms> before NX.
      const result = await client.set(
        LeaderElectionService.LEADER_KEY,
        nodeId,
        'PX',
        this.config.leaderLeaseTtlMs,
        'NX',
      );

      if (result === 'OK') {
        this._isLeader = true;
        this.startRenewalLoop();
        this.heartbeatService.startDeadWorkerScanner();

        const payload: LeadershipGainedPayload = {
          nodeId,
          gainedAt: new Date(),
        };
        this.emit(LEADER_ELECTION_EVENTS.GAINED, payload);

        this.logger.log(`Leadership GAINED by nodeId=${nodeId}`, this.context);
      }
    } catch (err) {
      this.logger.error(
        `Leader election attempt failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
    }
  }

  private startRenewalLoop(): void {
    if (this.renewalTimer) return;

    this.renewalTimer = setInterval(
      () => void this.renewLeadership(),
      this.config.leaderRenewalIntervalMs,
    );
  }

  private async renewLeadership(): Promise<void> {
    if (!this._isLeader) return;

    try {
      const client = this.redis.getClient();
      const nodeId = this.workerIdService.nodeId;

      const renewed = (await client.eval(
        LeaderElectionService.RENEWAL_SCRIPT,
        1,
        LeaderElectionService.LEADER_KEY,
        nodeId,
        String(this.config.leaderLeaseTtlMs),
      )) as number;

      if (renewed === 1) {
        const payload: LeadershipRenewedPayload = {
          nodeId,
          renewedAt: new Date(),
          leaseTtlMs: this.config.leaderLeaseTtlMs,
        };
        this.emit(LEADER_ELECTION_EVENTS.RENEWED, payload);

        this.logger.debug(`Leader lease renewed — nodeId=${nodeId}`, this.context);
      } else {
        // Another node hijacked the key — this shouldn't happen under normal
        // operation but can occur if the leader was paused (GC/stop-the-world)
        // long enough for the TTL to expire
        this.logger.warn(
          `Leader lease renewal failed — key was taken by another node; losing leadership`,
          this.context,
        );
        await this.loseLeadership('renewal_failed');
      }
    } catch (err) {
      this.logger.error(
        `Leader renewal error: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
      // On Redis connectivity loss let the TTL expire naturally; do not
      // immediately declare leadership lost — the connection may recover before TTL
    }
  }

  private async releaseLeadership(reason: LeadershipLostPayload['reason']): Promise<void> {
    try {
      const client = this.redis.getClient();
      const nodeId = this.workerIdService.nodeId;
      await client.eval(
        LeaderElectionService.RELEASE_SCRIPT,
        1,
        LeaderElectionService.LEADER_KEY,
        nodeId,
      );
      this.logger.log(`Leader lease released — nodeId=${nodeId}, reason=${reason}`, this.context);
    } catch {
      // Best-effort; TTL will clean up
    }
    await this.loseLeadership(reason);
  }

  private async loseLeadership(reason: LeadershipLostPayload['reason']): Promise<void> {
    if (!this._isLeader) return;

    this._isLeader = false;

    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }

    this.heartbeatService.stopDeadWorkerScanner();

    const payload: LeadershipLostPayload = {
      nodeId: this.workerIdService.nodeId,
      lostAt: new Date(),
      reason,
    };
    this.emit(LEADER_ELECTION_EVENTS.LOST, payload);

    this.logger.log(
      `Leadership LOST — nodeId=${this.workerIdService.nodeId}, reason=${reason}`,
      this.context,
    );
  }
}
