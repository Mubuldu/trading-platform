import { Injectable, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ILogger, LOGGER_TOKEN } from '@core/logging/logger.interface';
import { RiskConfig } from '@config/risk.config';
import { StrategyConfig } from '@config/strategy.config';
import { MonitoringConfig } from '@config/monitoring.config';
import { AlertsConfig } from '@config/alerts.config';
import { ReloadableDomain, ConfigChangedEvent, ConfigChangeListener } from './config-reload.event';
import { reloadableEnvSchema } from '@config/env.validation';

const CONTEXT = 'ReloadableConfigService';

/**
 * ReloadableConfigService manages the four hot-reloadable configuration domains:
 * risk, strategy, monitoring (thresholds), and alerts.
 *
 * Hot reload is triggered by SIGHUP (Unix standard signal for config refresh):
 *   docker kill --signal HUP <container>
 *   kill -HUP <pid>
 *
 * Reload contract:
 *   1. Re-reads the .env.<environment> file from disk
 *   2. Merges with current process.env (file values take precedence for reloadable keys)
 *   3. Validates the reloadable subset against reloadableEnvSchema
 *   4. If valid: updates in-memory snapshots and fires change events per domain
 *   5. If invalid: retains current values unchanged and logs every constraint violation
 *
 * Sensitive values (API keys, database credentials, exchange URLs) are NOT
 * hot-reloadable by design — they are read only at startup and require a
 * full process restart to change.
 *
 * Consumers subscribe to domain-scoped change events:
 *   reloadableConfig.on('risk', (event) => applyNewRiskLimits(event.current));
 */
@Injectable()
export class ReloadableConfigService implements OnModuleInit, OnModuleDestroy {
  private risk!: RiskConfig;
  private strategy!: StrategyConfig;
  private monitoring!: MonitoringConfig;
  private alerts!: AlertsConfig;

  private readonly envFilePath: string;
  private readonly listeners = new Map<ReloadableDomain, Set<ConfigChangeListener<unknown>>>();
  private sighupHandler: (() => void) | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
    envFilePath?: string,
  ) {
    const env = process.env.NODE_ENV ?? 'development';
    this.envFilePath = envFilePath ?? `.env.${env}`;
  }

  onModuleInit(): void {
    this.risk = this.configService.get<RiskConfig>('risk')!;
    this.strategy = this.configService.get<StrategyConfig>('strategy')!;
    this.monitoring = this.configService.get<MonitoringConfig>('monitoring')!;
    this.alerts = this.configService.get<AlertsConfig>('alerts')!;

    this.sighupHandler = (): void => {
      void this.reload();
    };
    process.on('SIGHUP', this.sighupHandler);
  }

  onModuleDestroy(): void {
    if (this.sighupHandler) {
      process.off('SIGHUP', this.sighupHandler);
      this.sighupHandler = null;
    }
  }

  getRisk(): Readonly<RiskConfig> {
    return this.risk;
  }

  getStrategy(): Readonly<StrategyConfig> {
    return this.strategy;
  }

  getMonitoring(): Readonly<MonitoringConfig> {
    return this.monitoring;
  }

  getAlerts(): Readonly<AlertsConfig> {
    return this.alerts;
  }

  on<T>(domain: ReloadableDomain, listener: ConfigChangeListener<T>): void {
    if (!this.listeners.has(domain)) {
      this.listeners.set(domain, new Set());
    }
    this.listeners.get(domain)!.add(listener as ConfigChangeListener<unknown>);
  }

  off<T>(domain: ReloadableDomain, listener: ConfigChangeListener<T>): void {
    this.listeners.get(domain)?.delete(listener as ConfigChangeListener<unknown>);
  }

  /**
   * Performs a hot reload. Called automatically on SIGHUP; also callable
   * programmatically (e.g., from an admin endpoint in non-production environments).
   *
   * Returns true when all domains reload successfully, false if validation
   * fails (in which case all previous values are retained).
   */
  async reload(): Promise<boolean> {
    const merged = await this.buildMergedEnv();
    const { error, value } = reloadableEnvSchema.validate(merged);

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      this.logger.warn(`Config reload rejected — validation failed: ${messages}`, CONTEXT);
      return false;
    }

    const validated = value as Record<string, unknown>;
    const reloadedAt = new Date();

    this.applyRisk(validated, reloadedAt);
    this.applyStrategy(validated, reloadedAt);
    this.applyMonitoring(validated, reloadedAt);
    this.applyAlerts(validated, reloadedAt);

    this.logger.info('Configuration hot-reloaded successfully', CONTEXT);
    return true;
  }

  private async buildMergedEnv(): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = { ...process.env };

    if (!existsSync(this.envFilePath)) {
      return merged;
    }

    try {
      const content = await readFile(this.envFilePath, 'utf-8');
      const fileVars = parseEnvContent(content);
      Object.assign(merged, fileVars);
    } catch (err) {
      this.logger.warn(
        `Could not read env file "${this.envFilePath}" — using current process.env values: ${(err as Error).message}`,
        CONTEXT,
      );
    }

    return merged;
  }

  private applyRisk(env: Record<string, unknown>, reloadedAt: Date): void {
    const next: RiskConfig = {
      ...this.risk,
      enabled: env.RISK_ENABLED as boolean,
      maxPositionSizeUsd: env.RISK_MAX_POSITION_SIZE_USD as number,
      maxDrawdownPercent: env.RISK_MAX_DRAWDOWN_PERCENT as number,
      maxDailyLossUsd: env.RISK_MAX_DAILY_LOSS_USD as number,
      maxOrderSizeUsd: env.RISK_MAX_ORDER_SIZE_USD as number,
      maxLeverage: env.RISK_MAX_LEVERAGE as number,
      maxOpenOrders: env.RISK_MAX_OPEN_ORDERS as number,
      maxConcentrationPercent: env.RISK_MAX_CONCENTRATION_PERCENT as number,
    };
    const previous = this.risk;
    this.risk = next;
    this.emit<RiskConfig>('risk', { domain: 'risk', previous, current: next, reloadedAt });
  }

  private applyStrategy(env: Record<string, unknown>, reloadedAt: Date): void {
    const rawIds = (env.STRATEGY_ENABLED_IDS as string) ?? '';
    const next: StrategyConfig = {
      enabledIds: rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      defaultSymbol: env.STRATEGY_DEFAULT_SYMBOL as string,
      maxConcurrent: env.STRATEGY_MAX_CONCURRENT as number,
      heartbeatIntervalMs: env.STRATEGY_HEARTBEAT_INTERVAL_MS as number,
      orderCooldownMs: env.STRATEGY_ORDER_COOLDOWN_MS as number,
    };
    const previous = this.strategy;
    this.strategy = next;
    this.emit<StrategyConfig>('strategy', {
      domain: 'strategy',
      previous,
      current: next,
      reloadedAt,
    });
  }

  private applyMonitoring(env: Record<string, unknown>, reloadedAt: Date): void {
    const next: MonitoringConfig = {
      metrics: this.monitoring.metrics,
      thresholds: {
        latencyWarnMs: env.MONITORING_LATENCY_WARN_MS as number,
        errorRateWarnPercent: env.MONITORING_ERROR_RATE_WARN_PERCENT as number,
        memoryWarnPercent: env.MONITORING_MEMORY_WARN_PERCENT as number,
        cpuWarnPercent: env.MONITORING_CPU_WARN_PERCENT as number,
      },
    };
    const previous = this.monitoring;
    this.monitoring = next;
    this.emit<MonitoringConfig>('monitoring', {
      domain: 'monitoring',
      previous,
      current: next,
      reloadedAt,
    });
  }

  private applyAlerts(env: Record<string, unknown>, reloadedAt: Date): void {
    // Merge reloadable threshold fields into the current full config snapshot
    const current = this.configService.get<AlertsConfig>('alerts')!;
    const next: AlertsConfig = {
      ...current,
      enabled: env.ALERTS_ENABLED as boolean,
      cooldownSeconds: env.ALERTS_COOLDOWN_SECONDS as number,
      escalationThreshold:
        (env.ALERTS_ESCALATION_THRESHOLD as number) ?? current.escalationThreshold,
      escalationWindowSeconds:
        (env.ALERTS_ESCALATION_WINDOW_SECONDS as number) ?? current.escalationWindowSeconds,
      thresholds: {
        priceDeviationWarnPercent: env.ALERTS_PRICE_DEVIATION_WARN_PERCENT as number,
        latencyWarnMs: env.ALERTS_LATENCY_WARN_MS as number,
        errorRateWarnPercent: env.ALERTS_ERROR_RATE_WARN_PERCENT as number,
        drawdownWarnPercent: env.ALERTS_DRAWDOWN_WARN_PERCENT as number,
        positionUtilizationWarnPercent: env.ALERTS_POSITION_WARN_PERCENT as number,
        fillRateWarnPercent: env.ALERTS_FILL_RATE_WARN_PERCENT as number,
        cpuWarnPercent:
          (env.ALERTS_CPU_WARN_PERCENT as number) ?? current.thresholds.cpuWarnPercent,
        memoryWarnPercent:
          (env.ALERTS_MEMORY_WARN_PERCENT as number) ?? current.thresholds.memoryWarnPercent,
        diskWarnPercent:
          (env.ALERTS_DISK_WARN_PERCENT as number) ?? current.thresholds.diskWarnPercent,
        queueLagWarnMessages:
          (env.ALERTS_QUEUE_LAG_WARN_MESSAGES as number) ?? current.thresholds.queueLagWarnMessages,
      },
    };
    const previous = this.alerts;
    this.alerts = next;
    this.emit<AlertsConfig>('alerts', { domain: 'alerts', previous, current: next, reloadedAt });
  }

  private emit<T>(domain: ReloadableDomain, event: ConfigChangedEvent<T>): void {
    const domainListeners = this.listeners.get(domain);
    if (!domainListeners) return;
    for (const listener of domainListeners) {
      try {
        (listener as ConfigChangeListener<T>)(event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Listener error on domain "${domain}": ${msg}`,
          err instanceof Error ? err.stack : undefined,
          CONTEXT,
        );
      }
    }
  }
}

/**
 * Parses a .env file content string into a key-value record.
 * Handles:
 *   - Single and double quoted values
 *   - Comment lines (# prefix)
 *   - Blank lines
 *   - Inline comments are NOT stripped (matches dotenv behaviour for simple values)
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}
