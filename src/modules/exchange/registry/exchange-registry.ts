import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Result, ok, err } from '@common/result';
import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { ExchangeCapabilities } from '../models/exchange.models';
import {
  ExchangeHealthStatus,
  HealthCheckSummary,
  ConnectionStatus,
  RateLimitHealthLevel,
} from '../models/health.models';
import { ExchangeId } from '../enums/exchange.enums';
import { AdapterRegistry } from '../adapters/adapter-registry';
import { ExchangeError, ExchangeConnectionError } from '../errors/exchange.error';

/**
 * ExchangeRegistry is the authoritative store for all exchange adapters in a
 * multi-exchange deployment.
 *
 * It wraps AdapterRegistry and adds four critical concerns that go beyond
 * simple instance management:
 *
 *  1. Enable / Disable — an exchange can be registered (known) but disabled
 *     (not routable). The ExchangeRouter skips disabled exchanges. This
 *     supports maintenance windows, partial rollouts, and A/B switching.
 *
 *  2. Health Tracking — health status is stored per exchange and updated by
 *     runHealthCheck(). The router reads this before routing orders.
 *
 *  3. Capability Discovery — callers can enumerate which exchanges support a
 *     given feature (e.g. supportsBatchOrders) without holding an adapter ref.
 *
 *  4. Connection Status — surfaces a normalised ConnectionStatus for each
 *     exchange, suitable for dashboards and the /health endpoint.
 *
 * Registration flow:
 *   Adapter module  →  registry.register(id, creator)
 *                       ↓
 *   Operator        →  registry.enable(id)
 *                       ↓
 *   ExchangeRouter  →  registry.getEnabledAdapter(id)
 *
 * Design: ExchangeRegistry delegates actual adapter lifecycle to AdapterRegistry.
 * It does NOT hold adapter instances directly — the AdapterRegistry does. This
 * preserves the existing singleton-per-ExchangeId guarantee.
 */
@Injectable()
export class ExchangeRegistry {
  private readonly enabled = new Set<ExchangeId>();
  private readonly healthStatuses = new Map<ExchangeId, ExchangeHealthStatus>();
  private readonly context = ExchangeRegistry.name;

  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register an exchange adapter factory.
   * Delegates to AdapterRegistry; does NOT auto-enable the exchange.
   * Call enable() separately to make the exchange routable.
   */
  register(exchangeId: ExchangeId, creator: () => ExchangeAdapter): void {
    this.adapterRegistry.register(exchangeId, creator);
    this.logger.debug(`Exchange registered (disabled): ${exchangeId}`, this.context);
  }

  /**
   * Register and immediately enable an exchange.
   * Shorthand for register() + enable() in one call.
   */
  registerAndEnable(exchangeId: ExchangeId, creator: () => ExchangeAdapter): void {
    this.register(exchangeId, creator);
    this.enable(exchangeId);
  }

  // ── Enable / Disable ──────────────────────────────────────────────────────

  /**
   * Enable an exchange for routing. The exchange must be registered first.
   * Throws if the exchange is not registered — fail fast at startup, not at runtime.
   */
  enable(exchangeId: ExchangeId): void {
    if (!this.adapterRegistry.has(exchangeId)) {
      throw new Error(
        `ExchangeRegistry.enable(): exchange "${exchangeId}" is not registered. ` +
          `Call register() before enable().`,
      );
    }
    this.enabled.add(exchangeId);
    this.logger.log(`Exchange enabled: ${exchangeId}`, this.context);
  }

  /**
   * Disable an exchange. Disabled exchanges are skipped by the router.
   * Already-open connections and in-flight orders are NOT affected —
   * disabling only prevents new routing decisions from targeting this exchange.
   */
  disable(exchangeId: ExchangeId): void {
    this.enabled.delete(exchangeId);
    this.logger.warn(`Exchange disabled: ${exchangeId}`, this.context);
  }

  isEnabled(exchangeId: ExchangeId): boolean {
    return this.enabled.has(exchangeId);
  }

  isRegistered(exchangeId: ExchangeId): boolean {
    return this.adapterRegistry.has(exchangeId);
  }

  // ── Adapter access ────────────────────────────────────────────────────────

  /**
   * Return the adapter for an exchange regardless of enabled/disabled status.
   * Returns null if the exchange is not registered.
   */
  getAdapter(exchangeId: ExchangeId): ExchangeAdapter | null {
    if (!this.adapterRegistry.has(exchangeId)) return null;
    try {
      return this.adapterRegistry.create(exchangeId);
    } catch {
      return null;
    }
  }

  /**
   * Return the adapter only if the exchange is enabled.
   * This is what ExchangeRouter uses.
   */
  getEnabledAdapter(exchangeId: ExchangeId): ExchangeAdapter | null {
    if (!this.isEnabled(exchangeId)) return null;
    return this.getAdapter(exchangeId);
  }

  /**
   * Return an adapter wrapped in Result, suitable for router usage.
   */
  resolveAdapter(exchangeId: ExchangeId): Result<ExchangeAdapter, ExchangeError> {
    if (!this.isRegistered(exchangeId)) {
      return err(new ExchangeConnectionError(exchangeId));
    }
    if (!this.isEnabled(exchangeId)) {
      return err(new ExchangeConnectionError(exchangeId));
    }
    const adapter = this.getAdapter(exchangeId);
    if (!adapter) {
      return err(new ExchangeConnectionError(exchangeId));
    }
    return ok(adapter);
  }

  // ── Health ────────────────────────────────────────────────────────────────

  getHealthStatus(exchangeId: ExchangeId): ExchangeHealthStatus | null {
    return this.healthStatuses.get(exchangeId) ?? null;
  }

  updateHealthStatus(exchangeId: ExchangeId, status: ExchangeHealthStatus): void {
    this.healthStatuses.set(exchangeId, status);
  }

  getConnectionStatus(exchangeId: ExchangeId): ConnectionStatus {
    return this.healthStatuses.get(exchangeId)?.connectionStatus ?? ConnectionStatus.UNKNOWN;
  }

  /**
   * Run an active health check against a specific exchange.
   * Pings the adapter, measures latency, and records the result.
   * The stored status is updated so future calls to getHealthStatus() reflect it.
   */
  async runHealthCheck(exchangeId: ExchangeId): Promise<ExchangeHealthStatus> {
    const adapter = this.getAdapter(exchangeId);
    const now = new Date();

    if (!adapter) {
      const status: ExchangeHealthStatus = {
        exchangeId,
        isEnabled: this.isEnabled(exchangeId),
        connectionStatus: ConnectionStatus.DISCONNECTED,
        restStatus: ConnectionStatus.DISCONNECTED,
        wsStatus: ConnectionStatus.UNKNOWN,
        latencyMs: null,
        clockDriftMs: null,
        rateLimitHealth: 'OK',
        isAuthenticated: false,
        isMaintenance: false,
        checkedAt: now,
      };
      this.healthStatuses.set(exchangeId, status);
      return status;
    }

    const startMs = Date.now();
    const healthResult = await adapter.healthCheck();
    const latencyMs = Date.now() - startMs;
    const isMaintenance = adapter.isMaintenanceMode();

    let connectionStatus: ConnectionStatus;
    if (isMaintenance) {
      connectionStatus = ConnectionStatus.MAINTENANCE;
    } else if (healthResult.isOk()) {
      connectionStatus = latencyMs > 2_000 ? ConnectionStatus.DEGRADED : ConnectionStatus.CONNECTED;
    } else {
      connectionStatus = ConnectionStatus.DISCONNECTED;
    }

    const status: ExchangeHealthStatus = {
      exchangeId,
      isEnabled: this.isEnabled(exchangeId),
      connectionStatus,
      restStatus: connectionStatus,
      wsStatus: ConnectionStatus.UNKNOWN, // WS status tracked internally by adapter
      latencyMs: healthResult.isOk() ? latencyMs : null,
      clockDriftMs: null, // populated when server-time sync data is available
      rateLimitHealth: this.assessRateLimitHealth(adapter),
      isAuthenticated: healthResult.isOk(),
      isMaintenance,
      checkedAt: now,
    };

    this.healthStatuses.set(exchangeId, status);
    return status;
  }

  /**
   * Run health checks for all registered exchanges in parallel.
   * Returns a summary suitable for the /health endpoint.
   */
  async runAllHealthChecks(): Promise<HealthCheckSummary> {
    const exchanges = this.getSupportedExchanges();
    const results = await Promise.allSettled(exchanges.map((id) => this.runHealthCheck(id)));

    const healthy: ExchangeId[] = [];
    const degraded: ExchangeId[] = [];
    const unhealthy: ExchangeId[] = [];
    const maintenance: ExchangeId[] = [];
    const unknown: ExchangeId[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const id = exchanges[i];
      const status =
        result.status === 'fulfilled' ? result.value.connectionStatus : ConnectionStatus.UNKNOWN;

      switch (status) {
        case ConnectionStatus.CONNECTED:
          healthy.push(id);
          break;
        case ConnectionStatus.DEGRADED:
          degraded.push(id);
          break;
        case ConnectionStatus.MAINTENANCE:
          maintenance.push(id);
          break;
        case ConnectionStatus.DISCONNECTED:
          unhealthy.push(id);
          break;
        default:
          unknown.push(id);
      }
    }

    return { healthy, degraded, unhealthy, maintenance, unknown, checkedAt: new Date() };
  }

  // ── Capability discovery ──────────────────────────────────────────────────

  /**
   * Return the capabilities of a registered exchange without holding a ref.
   * Returns null if the exchange is not registered.
   */
  discoverCapabilities(exchangeId: ExchangeId): ExchangeCapabilities | null {
    const adapter = this.getAdapter(exchangeId);
    return adapter ? adapter.getCapabilities() : null;
  }

  /**
   * Return the full capability matrix for all registered exchanges.
   * Useful for the capability matrix documentation and routing decisions.
   */
  getCapabilityMatrix(): Map<ExchangeId, ExchangeCapabilities> {
    const matrix = new Map<ExchangeId, ExchangeCapabilities>();
    for (const id of this.getSupportedExchanges()) {
      const caps = this.discoverCapabilities(id);
      if (caps) matrix.set(id, caps);
    }
    return matrix;
  }

  /**
   * Find all enabled exchanges that support a given set of capabilities.
   * Used by the ExchangeRouter for capability-based routing.
   */
  findExchangesByCapabilities(required: ReadonlyArray<keyof ExchangeCapabilities>): ExchangeId[] {
    return this.getEnabledExchanges().filter((id) => {
      const caps = this.discoverCapabilities(id);
      if (!caps) return false;
      return required.every((cap) => {
        const value = caps[cap];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        return false;
      });
    });
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  getSupportedExchanges(): ExchangeId[] {
    return this.adapterRegistry.getSupportedExchanges();
  }

  getEnabledExchanges(): ExchangeId[] {
    return this.getSupportedExchanges().filter((id) => this.isEnabled(id));
  }

  getDisabledExchanges(): ExchangeId[] {
    return this.getSupportedExchanges().filter((id) => !this.isEnabled(id));
  }

  getActiveAdapters(): ExchangeAdapter[] {
    return this.adapterRegistry.getActiveAdapters();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private assessRateLimitHealth(adapter: ExchangeAdapter): RateLimitHealthLevel {
    const result = adapter.getRateLimitStatus();
    if (result.isErr()) return 'OK';

    const statuses = result.value;
    if (statuses.length === 0) return 'OK';

    const minRemainingFraction = Math.min(
      ...statuses.map((s) => (s.limit > 0 ? s.remaining / s.limit : 1)),
    );

    if (minRemainingFraction < 0.05) return 'CRITICAL';
    if (minRemainingFraction < 0.2) return 'WARNING';
    return 'OK';
  }
}
