import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { StrategyState } from '../domain/enums/strategy-state.enum';
import {
  StrategyAlreadyRegisteredError,
  StrategyError,
  StrategyInitializationError,
  StrategyNotFoundError,
} from '../domain/errors/strategy.errors';
import { IStrategy, StrategyHealth, StrategyPluginConfig } from '../interfaces/strategy.interface';
import {
  IStrategyRegistry,
  StrategyRegistryHealth,
} from '../interfaces/strategy-registry.interface';

@Injectable()
export class StrategyRegistryService implements IStrategyRegistry {
  private readonly strategies = new Map<string, IStrategy>();

  register(strategy: IStrategy): Result<void, StrategyAlreadyRegisteredError> {
    if (this.strategies.has(strategy.id)) {
      return err(new StrategyAlreadyRegisteredError(strategy.id));
    }
    this.strategies.set(strategy.id, strategy);
    return ok(undefined);
  }

  unregister(id: string): Result<void, StrategyNotFoundError> {
    if (!this.strategies.has(id)) {
      return err(new StrategyNotFoundError(id));
    }
    this.strategies.delete(id);
    return ok(undefined);
  }

  enable(id: string): Result<void, StrategyNotFoundError> {
    const strategy = this.strategies.get(id);
    if (!strategy) return err(new StrategyNotFoundError(id));
    strategy.setEnabled(true);
    return ok(undefined);
  }

  disable(id: string): Result<void, StrategyNotFoundError> {
    const strategy = this.strategies.get(id);
    if (!strategy) return err(new StrategyNotFoundError(id));
    strategy.setEnabled(false);
    return ok(undefined);
  }

  async reload(id: string, newConfig: StrategyPluginConfig): Promise<Result<void, StrategyError>> {
    const strategy = this.strategies.get(id);
    if (!strategy) return err(new StrategyNotFoundError(id));

    const validation = strategy.validateConfiguration(newConfig);
    if (validation.isErr()) return err(validation.error);

    try {
      await strategy.loadConfiguration(newConfig);
      return ok(undefined);
    } catch (e) {
      return err(new StrategyInitializationError(id, e instanceof Error ? e.message : String(e)));
    }
  }

  get(id: string): Result<IStrategy, StrategyNotFoundError> {
    const strategy = this.strategies.get(id);
    if (!strategy) return err(new StrategyNotFoundError(id));
    return ok(strategy);
  }

  getAll(): IStrategy[] {
    return [...this.strategies.values()];
  }

  getEnabled(): IStrategy[] {
    return this.getAll().filter((s) => s.getHealth().enabled);
  }

  getVersion(id: string): Result<string, StrategyNotFoundError> {
    const strategy = this.strategies.get(id);
    if (!strategy) return err(new StrategyNotFoundError(id));
    return ok(strategy.version);
  }

  getHealth(): StrategyRegistryHealth {
    const all = this.getAll();
    const byState: Record<string, number> = {};
    const strategies: StrategyHealth[] = [];
    let enabled = 0;
    let inError = 0;

    for (const strategy of all) {
      const health = strategy.getHealth();
      strategies.push(health);

      byState[health.state] = (byState[health.state] ?? 0) + 1;
      if (health.enabled) enabled++;
      if (health.state === StrategyState.ERROR) inError++;
    }

    return {
      totalRegistered: all.length,
      enabled,
      inError,
      byState,
      strategies,
    };
  }
}
