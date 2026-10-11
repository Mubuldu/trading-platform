import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { Timeframe } from '../../domain/enums/timeframe.enum';
import { IndicatorState } from '../../domain/enums/indicator-state.enum';
import {
  IndicatorAlreadyRegisteredError,
  IndicatorNotFoundError,
} from '../../domain/errors/indicator.errors';
import {
  IIndicatorCalculator,
  IndicatorHealth,
} from '../../interfaces/indicator-calculator.interface';
import {
  IIndicatorRegistry,
  WarmupStatus,
  IndicatorRegistryHealth,
} from '../../interfaces/indicator-registry.interface';

@Injectable()
export class IndicatorRegistryService implements IIndicatorRegistry {
  private readonly calculators = new Map<string, IIndicatorCalculator>();

  register(calculator: IIndicatorCalculator): Result<void, IndicatorAlreadyRegisteredError> {
    if (this.calculators.has(calculator.id)) {
      return err(new IndicatorAlreadyRegisteredError(calculator.id));
    }
    calculator.initialize();
    this.calculators.set(calculator.id, calculator);
    return ok(undefined);
  }

  remove(id: string): Result<void, IndicatorNotFoundError> {
    if (!this.calculators.has(id)) {
      return err(new IndicatorNotFoundError(id));
    }
    this.calculators.delete(id);
    return ok(undefined);
  }

  get(id: string): Result<IIndicatorCalculator, IndicatorNotFoundError> {
    const calc = this.calculators.get(id);
    if (!calc) return err(new IndicatorNotFoundError(id));
    return ok(calc);
  }

  getAll(): IIndicatorCalculator[] {
    return [...this.calculators.values()];
  }

  getBySymbolAndTimeframe(symbol: string, timeframe: Timeframe): IIndicatorCalculator[] {
    return [...this.calculators.values()].filter(
      (c) => c.config.symbol === symbol && c.config.timeframe === timeframe,
    );
  }

  getWarmupStatus(): WarmupStatus {
    const all = this.getAll();
    const warmedUp = all.filter((c) => c.isWarmedUp());
    const pending = all.filter((c) => !c.isWarmedUp()).map((c) => c.id);

    return {
      total: all.length,
      warmedUp: warmedUp.length,
      allWarmedUp: pending.length === 0 && all.length > 0,
      pending,
    };
  }

  getHealth(): IndicatorRegistryHealth {
    const all = this.getAll();
    const byType: Record<string, number> = {};
    const indicators: IndicatorHealth[] = [];

    let warmedUp = 0;
    let inError = 0;

    for (const calc of all) {
      const health = calc.getHealth();
      indicators.push(health);

      const typeName = calc.config.type;
      byType[typeName] = (byType[typeName] ?? 0) + 1;

      if (calc.isWarmedUp()) warmedUp++;
      if (calc.state === IndicatorState.ERROR) inError++;
    }

    return {
      totalRegistered: all.length,
      warmedUp,
      inError,
      byType,
      indicators,
    };
  }
}
