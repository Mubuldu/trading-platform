import { Injectable } from '@nestjs/common';
import { PortfolioStateModel } from '../../domain/models/portfolio-state.model';
import { PortfolioExposureModel } from '../../domain/models/portfolio-exposure.model';

export interface ConstraintViolation {
  readonly constraint: PortfolioConstraint;
  readonly message: string;
  readonly current: number;
  readonly limit: number;
}

export enum PortfolioConstraint {
  MAX_EXPOSURE = 'MAX_EXPOSURE',
  MAX_LEVERAGE = 'MAX_LEVERAGE',
  MAX_ASSET_ALLOCATION = 'MAX_ASSET_ALLOCATION',
  MAX_SYMBOL_ALLOCATION = 'MAX_SYMBOL_ALLOCATION',
  MAX_STRATEGY_ALLOCATION = 'MAX_STRATEGY_ALLOCATION',
}

export interface ConstraintConfig {
  maxExposurePercent: number;
  maxLeverage: number;
  maxAssetAllocationPercent: number;
}

@Injectable()
export class PortfolioConstraintsService {
  check(
    state: PortfolioStateModel,
    exposure: PortfolioExposureModel,
    config: ConstraintConfig,
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    const equity = state.accountEquity > 0 ? state.accountEquity : 1;

    const exposurePercent = (exposure.totalGrossExposure / equity) * 100;
    if (exposurePercent > config.maxExposurePercent) {
      violations.push({
        constraint: PortfolioConstraint.MAX_EXPOSURE,
        message: `Gross exposure ${exposurePercent.toFixed(1)}% exceeds limit ${config.maxExposurePercent}%`,
        current: exposurePercent,
        limit: config.maxExposurePercent,
      });
    }

    if (state.totalLeverage > config.maxLeverage) {
      violations.push({
        constraint: PortfolioConstraint.MAX_LEVERAGE,
        message: `Leverage ${state.totalLeverage.toFixed(2)}x exceeds limit ${config.maxLeverage}x`,
        current: state.totalLeverage,
        limit: config.maxLeverage,
      });
    }

    for (const [asset, notional] of Object.entries(exposure.byAsset)) {
      const assetPercent = (notional / equity) * 100;
      if (assetPercent > config.maxAssetAllocationPercent) {
        violations.push({
          constraint: PortfolioConstraint.MAX_ASSET_ALLOCATION,
          message: `Asset ${asset} allocation ${assetPercent.toFixed(1)}% exceeds limit ${config.maxAssetAllocationPercent}%`,
          current: assetPercent,
          limit: config.maxAssetAllocationPercent,
        });
      }
    }

    return violations;
  }

  hasViolations(violations: ConstraintViolation[]): boolean {
    return violations.length > 0;
  }
}
