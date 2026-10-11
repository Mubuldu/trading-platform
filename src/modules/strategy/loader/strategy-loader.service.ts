import { Injectable } from '@nestjs/common';
import { IStrategy, StrategyPluginConfig } from '../interfaces/strategy.interface';
import { StrategyRegistryService } from '../registry/strategy-registry.service';

export type StrategyFactory = (config: StrategyPluginConfig) => IStrategy;

/**
 * StrategyLoaderService is the plugin registration point.
 *
 * Strategy plugin authors call registerFactory() once during module init.
 * The loader then instantiates strategies on demand from those factories.
 * This keeps the core application blind to concrete strategy implementations.
 *
 * Hot-reload flow:
 *   1. Config changes arrive (e.g. SIGHUP → ReloadableConfigService)
 *   2. Caller invokes registry.reload(id, newConfig)
 *   3. loadConfiguration() is called on the existing instance — no restart needed
 */
@Injectable()
export class StrategyLoaderService {
  private readonly factories = new Map<string, StrategyFactory>();

  constructor(private readonly registry: StrategyRegistryService) {}

  registerFactory(strategyType: string, factory: StrategyFactory): void {
    this.factories.set(strategyType, factory);
  }

  hasFactory(strategyType: string): boolean {
    return this.factories.has(strategyType);
  }

  getRegisteredTypes(): string[] {
    return [...this.factories.keys()];
  }

  async load(strategyType: string, config: StrategyPluginConfig): Promise<IStrategy> {
    const factory = this.factories.get(strategyType);
    if (!factory) {
      throw new Error(
        `No factory registered for strategy type "${strategyType}". ` +
          `Registered types: [${this.getRegisteredTypes().join(', ')}]`,
      );
    }

    const strategy = factory(config);

    const validation = strategy.validateConfiguration(config);
    if (validation.isErr()) {
      throw validation.error;
    }

    await strategy.initialize();

    const registered = this.registry.register(strategy);
    if (registered.isErr()) {
      throw registered.error;
    }

    return strategy;
  }

  async loadAll(
    entries: Array<{ strategyType: string; config: StrategyPluginConfig }>,
  ): Promise<{ loaded: string[]; failed: Array<{ strategyType: string; reason: string }> }> {
    const loaded: string[] = [];
    const failed: Array<{ strategyType: string; reason: string }> = [];

    for (const entry of entries) {
      try {
        await this.load(entry.strategyType, entry.config);
        loaded.push(entry.config.strategyId);
      } catch (e) {
        failed.push({
          strategyType: entry.strategyType,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { loaded, failed };
  }
}
