import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Result, ok, err } from '@common/result';
import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { ExchangeCapabilities } from '../models/exchange.models';
import { ExchangeId } from '../enums/exchange.enums';
import { ExchangeRegistry } from '../registry/exchange-registry';
import { ConnectionStatus } from '../models/health.models';
import {
  ExchangeError,
  ExchangeConnectionError,
  ExchangeUnsupportedOperationError,
  ExchangeMaintenanceError,
} from '../errors/exchange.error';
import { RouteContext } from './route-context';
import { FailoverConfig, FailoverMode, FailoverState, FAILOVER_DEFAULTS } from './failover-config';

/**
 * ExchangeRouter is the single entry point for exchange-agnostic adapter
 * selection in a multi-exchange deployment.
 *
 * It sits between business modules (execution engine, strategies) and the
 * ExchangeRegistry. Callers describe WHAT they need via a RouteContext; the
 * router decides WHICH exchange satisfies that context.
 *
 * Routing algorithm:
 *  1. If a preferredExchangeId is given:
 *     a. Check whether that exchange is in active failover → redirect to secondary.
 *     b. Check whether it is in maintenance → return ExchangeMaintenanceError.
 *     c. Validate required capabilities → return ExchangeUnsupportedOperationError.
 *     d. Return the adapter.
 *  2. If no preferred exchange:
 *     a. Find all enabled exchanges that satisfy requiredCapabilities.
 *     b. Return the first healthy candidate (CONNECTED or DEGRADED status ranks above UNKNOWN).
 *     c. If no candidate, return ExchangeConnectionError.
 *
 * Failover:
 *  - configureFailover() registers a policy for a primary exchange.
 *  - AUTOMATIC mode: router transparently redirects to secondary when the
 *    primary's health status is DISCONNECTED or MAINTENANCE.
 *  - MANUAL mode: operator calls triggerManualFailover() explicitly.
 *  - clearFailover() reverts routing back to the primary.
 *  - enableMaintenanceMode() / disableMaintenanceMode() expose planned windows.
 *
 * Thread safety: all state is modified synchronously in NestJS's single-threaded
 * event loop. No additional locking is needed.
 */
@Injectable()
export class ExchangeRouter {
  private readonly failoverConfigs = new Map<ExchangeId, FailoverConfig>();
  private readonly activeFailovers = new Map<ExchangeId, FailoverState>();
  private readonly maintenanceExchanges = new Set<ExchangeId>();
  private readonly context = ExchangeRouter.name;

  constructor(
    private readonly registry: ExchangeRegistry,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Routing ───────────────────────────────────────────────────────────────

  /**
   * Resolve the best adapter for the given RouteContext.
   *
   * Returns err() only when no adapter can service the request.
   * Callers receive a typed ExchangeError they can handle (rate limit,
   * maintenance, unsupported capability, no exchange, etc.).
   */
  route(context: RouteContext): Result<ExchangeAdapter, ExchangeError> {
    const { preferredExchangeId, requiredCapabilities } = context;

    if (preferredExchangeId) {
      return this.routeToExchange(preferredExchangeId, requiredCapabilities);
    }

    return this.autoRoute(requiredCapabilities);
  }

  // ── Failover configuration ────────────────────────────────────────────────

  /**
   * Register a failover policy for an exchange.
   * Can be called multiple times to update the policy — the latest call wins.
   */
  configureFailover(config: FailoverConfig): void {
    const full: FailoverConfig = {
      ...config,
      healthCheckIntervalMs:
        config.healthCheckIntervalMs ?? FAILOVER_DEFAULTS.healthCheckIntervalMs,
      failoverThresholdMs: config.failoverThresholdMs ?? FAILOVER_DEFAULTS.failoverThresholdMs,
      recoveryThresholdMs: config.recoveryThresholdMs ?? FAILOVER_DEFAULTS.recoveryThresholdMs,
    };
    this.failoverConfigs.set(config.primaryExchangeId, full);
    this.logger.log(
      `Failover configured: ${config.primaryExchangeId} → ` +
        `${config.secondaryExchangeId ?? 'none'} (mode=${config.mode})`,
      this.context,
    );
  }

  getFailoverConfig(exchangeId: ExchangeId): FailoverConfig | null {
    return this.failoverConfigs.get(exchangeId) ?? null;
  }

  // ── Failover triggers ─────────────────────────────────────────────────────

  /**
   * Manually trigger a failover from one exchange to another.
   * Requires a MANUAL failover policy to be configured for the primary.
   *
   * Use this during planned maintenance or when manual control is required.
   */
  triggerManualFailover(from: ExchangeId, to: ExchangeId): Result<void, ExchangeError> {
    const config = this.failoverConfigs.get(from);
    if (!config || config.mode === FailoverMode.NONE) {
      return err(
        new ExchangeUnsupportedOperationError(
          from,
          `triggerManualFailover: no manual failover policy configured for "${from}"`,
        ),
      );
    }

    if (!this.registry.isRegistered(to)) {
      return err(
        new ExchangeConnectionError(to, new Error(`Failover target "${to}" is not registered`)),
      );
    }

    if (!this.registry.isEnabled(to)) {
      return err(
        new ExchangeConnectionError(
          to,
          new Error(`Failover target "${to}" is registered but disabled`),
        ),
      );
    }

    const state: FailoverState = {
      primaryExchangeId: from,
      activeExchangeId: to,
      mode: FailoverMode.MANUAL,
      triggeredAt: new Date(),
      triggeredBy: 'manual',
    };
    this.activeFailovers.set(from, state);
    this.logger.warn(`Manual failover triggered: ${from} → ${to}`, this.context);
    return ok(undefined);
  }

  /**
   * Trigger an automatic failover (called by a health monitor or scheduler).
   * Requires an AUTOMATIC failover policy to be configured.
   */
  triggerAutomaticFailover(from: ExchangeId): Result<void, ExchangeError> {
    const config = this.failoverConfigs.get(from);
    if (!config || config.mode !== FailoverMode.AUTOMATIC) {
      return err(
        new ExchangeUnsupportedOperationError(
          from,
          `triggerAutomaticFailover: no automatic failover policy configured for "${from}"`,
        ),
      );
    }

    if (!config.secondaryExchangeId) {
      return err(
        new ExchangeUnsupportedOperationError(
          from,
          `triggerAutomaticFailover: no secondary exchange configured for "${from}"`,
        ),
      );
    }

    const to = config.secondaryExchangeId;
    if (!this.registry.isEnabled(to)) {
      return err(
        new ExchangeConnectionError(
          to,
          new Error(`Automatic failover target "${to}" is not enabled`),
        ),
      );
    }

    const state: FailoverState = {
      primaryExchangeId: from,
      activeExchangeId: to,
      mode: FailoverMode.AUTOMATIC,
      triggeredAt: new Date(),
      triggeredBy: 'automatic',
    };
    this.activeFailovers.set(from, state);
    this.logger.warn(`Automatic failover triggered: ${from} → ${to}`, this.context);
    return ok(undefined);
  }

  /**
   * Clear an active failover and restore routing to the primary exchange.
   * Safe to call even when no failover is active.
   */
  clearFailover(exchangeId: ExchangeId): void {
    if (this.activeFailovers.has(exchangeId)) {
      this.activeFailovers.delete(exchangeId);
      this.logger.log(`Failover cleared, routing restored: ${exchangeId}`, this.context);
    }
  }

  getFailoverState(exchangeId: ExchangeId): FailoverState | null {
    return this.activeFailovers.get(exchangeId) ?? null;
  }

  isInFailover(exchangeId: ExchangeId): boolean {
    return this.activeFailovers.has(exchangeId);
  }

  // ── Maintenance mode ──────────────────────────────────────────────────────

  /**
   * Enable maintenance mode for an exchange.
   * The exchange is disabled for routing and a maintenance failover is activated
   * if a secondary is configured (preferring maintenanceWindowExchangeId over secondaryExchangeId).
   */
  enableMaintenanceMode(exchangeId: ExchangeId): void {
    this.maintenanceExchanges.add(exchangeId);
    this.registry.disable(exchangeId);

    const config = this.failoverConfigs.get(exchangeId);
    const fallback = config?.maintenanceWindowExchangeId ?? config?.secondaryExchangeId;

    if (fallback && this.registry.isEnabled(fallback)) {
      const state: FailoverState = {
        primaryExchangeId: exchangeId,
        activeExchangeId: fallback,
        mode: config?.mode ?? FailoverMode.MANUAL,
        triggeredAt: new Date(),
        triggeredBy: 'maintenance',
      };
      this.activeFailovers.set(exchangeId, state);
      this.logger.warn(`Maintenance mode: ${exchangeId} → fallback to ${fallback}`, this.context);
    } else {
      this.logger.warn(`Maintenance mode: ${exchangeId} — no fallback configured`, this.context);
    }
  }

  disableMaintenanceMode(exchangeId: ExchangeId): void {
    this.maintenanceExchanges.delete(exchangeId);
    this.activeFailovers.delete(exchangeId);

    if (this.registry.isRegistered(exchangeId)) {
      this.registry.enable(exchangeId);
    }
    this.logger.log(`Maintenance mode cleared: ${exchangeId}`, this.context);
  }

  isInMaintenanceMode(exchangeId: ExchangeId): boolean {
    return this.maintenanceExchanges.has(exchangeId);
  }

  // ── Private routing helpers ───────────────────────────────────────────────

  private routeToExchange(
    exchangeId: ExchangeId,
    requiredCapabilities?: ReadonlyArray<keyof ExchangeCapabilities>,
  ): Result<ExchangeAdapter, ExchangeError> {
    // 1. Check maintenance
    if (this.maintenanceExchanges.has(exchangeId)) {
      const failoverState = this.activeFailovers.get(exchangeId);
      if (failoverState) {
        this.logger.debug(
          `${exchangeId} is in maintenance — redirecting to ${failoverState.activeExchangeId}`,
          this.context,
        );
        return this.resolveAdapter(failoverState.activeExchangeId, requiredCapabilities);
      }
      return err(new ExchangeMaintenanceError(exchangeId));
    }

    // 2. Check failover
    const failoverState = this.activeFailovers.get(exchangeId);
    if (failoverState) {
      this.logger.debug(
        `${exchangeId} is in ${failoverState.mode} failover — redirecting to ${failoverState.activeExchangeId}`,
        this.context,
      );
      return this.resolveAdapter(failoverState.activeExchangeId, requiredCapabilities);
    }

    // 3. Check automatic failover trigger from health status
    const config = this.failoverConfigs.get(exchangeId);
    if (config?.mode === FailoverMode.AUTOMATIC && config.secondaryExchangeId) {
      const healthStatus = this.registry.getConnectionStatus(exchangeId);
      if (
        healthStatus === ConnectionStatus.DISCONNECTED ||
        healthStatus === ConnectionStatus.MAINTENANCE
      ) {
        this.logger.warn(
          `${exchangeId} health=${healthStatus}, auto-failing over to ${config.secondaryExchangeId}`,
          this.context,
        );
        void this.triggerAutomaticFailover(exchangeId);
        return this.resolveAdapter(config.secondaryExchangeId, requiredCapabilities);
      }
    }

    return this.resolveAdapter(exchangeId, requiredCapabilities);
  }

  private autoRoute(
    requiredCapabilities?: ReadonlyArray<keyof ExchangeCapabilities>,
  ): Result<ExchangeAdapter, ExchangeError> {
    let candidates = requiredCapabilities
      ? this.registry.findExchangesByCapabilities(requiredCapabilities)
      : this.registry.getEnabledExchanges();

    // Exclude exchanges in active failover or maintenance (primary already excluded by disable)
    candidates = candidates.filter((id) => !this.maintenanceExchanges.has(id));

    if (candidates.length === 0) {
      return err(
        new ExchangeConnectionError(
          ExchangeId.PAPER_TRADING, // sentinel — no specific exchange failed
          new Error(
            `No enabled exchange satisfies required capabilities: ` +
              (requiredCapabilities?.join(', ') ?? 'none'),
          ),
        ),
      );
    }

    // Prefer CONNECTED > DEGRADED > UNKNOWN to rank candidates
    const ranked = this.rankCandidates(candidates);
    return this.resolveAdapter(ranked[0]);
  }

  private resolveAdapter(
    exchangeId: ExchangeId,
    requiredCapabilities?: ReadonlyArray<keyof ExchangeCapabilities>,
  ): Result<ExchangeAdapter, ExchangeError> {
    const adapterResult = this.registry.resolveAdapter(exchangeId);
    if (adapterResult.isErr()) return adapterResult;

    const adapter = adapterResult.value;

    if (requiredCapabilities) {
      for (const cap of requiredCapabilities) {
        if (!adapter.isFeatureSupported(cap)) {
          return err(
            new ExchangeUnsupportedOperationError(
              exchangeId,
              `Required capability "${cap}" is not supported by "${exchangeId}"`,
            ),
          );
        }
      }
    }

    return ok(adapter);
  }

  private rankCandidates(candidates: ExchangeId[]): ExchangeId[] {
    const rank = (id: ExchangeId): number => {
      switch (this.registry.getConnectionStatus(id)) {
        case ConnectionStatus.CONNECTED:
          return 0;
        case ConnectionStatus.DEGRADED:
          return 1;
        case ConnectionStatus.UNKNOWN:
          return 2;
        default:
          return 3;
      }
    };
    return [...candidates].sort((a, b) => rank(a) - rank(b));
  }
}
