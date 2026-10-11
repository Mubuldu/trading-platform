import { Injectable } from '@nestjs/common';
import { PositionSummary } from '../../domain/models/portfolio-state.model';
import {
  DirectionExposure,
  PortfolioExposureModel,
} from '../../domain/models/portfolio-exposure.model';

@Injectable()
export class PortfolioExposureService {
  compute(positions: PositionSummary[]): PortfolioExposureModel {
    const open = positions.filter((p) => p.state !== 'FLAT' && p.quantity > 0);

    const bySymbol: Record<string, number> = {};
    const byAsset: Record<string, number> = {};
    const byExchange: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};
    let totalLong = 0;
    let totalShort = 0;

    for (const p of open) {
      const notional = p.notionalValue;
      const isShort = p.direction === 'SHORT';

      bySymbol[p.symbol] = (bySymbol[p.symbol] ?? 0) + notional;
      byAsset[p.asset] = (byAsset[p.asset] ?? 0) + notional;
      byExchange[p.exchangeId] = (byExchange[p.exchangeId] ?? 0) + notional;
      byStrategy[p.strategyId] = (byStrategy[p.strategyId] ?? 0) + notional;

      if (isShort) totalShort += notional;
      else totalLong += notional;
    }

    const byDirection: DirectionExposure = {
      long: totalLong,
      short: totalShort,
      net: totalLong - totalShort,
      gross: totalLong + totalShort,
    };

    return {
      bySymbol,
      byAsset,
      byExchange,
      byStrategy,
      byDirection,
      totalGrossExposure: totalLong + totalShort,
      totalNetExposure: totalLong - totalShort,
      computedAt: Date.now(),
    };
  }

  /**
   * Extract base asset from a trading symbol.
   * "BTCUSDT" → "BTC", "ETH/USDT" → "ETH", "BTCUSD_PERP" → "BTC"
   */
  extractAsset(symbol: string): string {
    if (symbol.includes('/')) return symbol.split('/')[0];
    const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'USD', 'TUSD', 'FDUSD'];
    for (const stable of stablecoins) {
      if (symbol.endsWith(stable)) {
        const base = symbol.slice(0, symbol.length - stable.length);
        if (base.length > 0) return base;
      }
    }
    // Fall back to first 3-4 chars for futures like BTCUSD_PERP
    const clean = symbol.replace(/_.*$/, '');
    return clean.length >= 3 ? clean.slice(0, 3) : clean;
  }
}
