import { RiskConfig } from '@config/risk.config';
import { StrategyConfig } from '@config/strategy.config';
import { MonitoringConfig } from '@config/monitoring.config';
import { AlertsConfig } from '@config/alerts.config';

export type ReloadableDomain = 'risk' | 'strategy' | 'monitoring' | 'alerts';

export interface ConfigChangedEvent<T> {
  readonly domain: ReloadableDomain;
  readonly previous: Readonly<T>;
  readonly current: Readonly<T>;
  readonly reloadedAt: Date;
}

export interface ReloadableSnapshot {
  readonly risk: Readonly<RiskConfig>;
  readonly strategy: Readonly<StrategyConfig>;
  readonly monitoring: Readonly<MonitoringConfig>;
  readonly alerts: Readonly<AlertsConfig>;
}

export type ConfigChangeListener<T> = (event: ConfigChangedEvent<T>) => void;
