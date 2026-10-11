import { MarkdownReportExporterService } from '@modules/reporting/application/exporters/markdown-report-exporter.service';
import { TradingReport } from '@modules/reporting/domain/models/report.model';
import { ReportPeriod } from '@modules/reporting/domain/enums/report-period.enum';
import { ReportSource } from '@modules/reporting/domain/enums/report-source.enum';
import { ReportStatus } from '@modules/reporting/domain/enums/report-status.enum';
import { ReportExportFormat } from '@modules/reporting/domain/enums/report-export-format.enum';
import {
  RecommendationPriority,
  RecommendationCategory,
} from '@modules/reporting/domain/models/sections/recommendations.section';

// ── Fixture ────────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<TradingReport> = {}): TradingReport {
  return {
    reportId: 'rpt_test',
    version: 1,
    generatedAt: 1_700_000_000_000,
    title: 'Paper Trading Daily Report — 2024-01-15',
    period: ReportPeriod.DAILY,
    source: ReportSource.PAPER,
    sessionId: 'paper_trading_default',
    strategyIds: [],
    periodStartDate: '2024-01-15',
    periodEndDate: '2024-01-15',
    periodStartMs: Date.UTC(2024, 0, 15),
    periodEndMs: Date.UTC(2024, 0, 15, 23, 59, 59, 999),
    snapshotIds: ['snap-1'],
    formats: [ReportExportFormat.MARKDOWN],
    status: ReportStatus.COMPLETE,
    generationDurationMs: 42,

    executiveSummary: {
      title: 'Paper Trading Daily Report — 2024-01-15',
      periodLabel: 'January 15, 2024 (Daily)',
      sourceLabel: 'Paper Trading',
      generatedAt: '2024-01-15T00:00:00.000Z',
      netPnl: 500,
      netPnlPercent: 5,
      totalReturn: 500,
      totalReturnPercent: 5,
      annualizedReturnPercent: 60,
      sharpeRatio: 1.5,
      sortinoRatio: 2.0,
      calmarRatio: 3.0,
      maxDrawdown: 0.05,
      maxDrawdownPercent: 5,
      totalTrades: 10,
      winRate: 0.6,
      profitFactor: 1.8,
      expectancy: 50,
      rolling30dReturnPercent: 8,
      rolling30dSharpe: 1.2,
      isProfit: true,
      isPositiveSharpe: true,
      highlights: ['Net P&L: +500.00 (+5.00%)', 'Sharpe: 1.50 (good)', 'Max DD: 5.00% (low)'],
    },

    portfolioPerformance: {
      initialCapital: 10_000,
      finalEquity: 10_500,
      currentBalance: 10_200,
      buyingPower: 10_200,
      netProfit: 500,
      grossProfit: 800,
      grossLoss: 300,
      realizedPnl: 500,
      unrealizedPnl: 0,
      totalCommissions: 20,
      totalReturnPercent: 5,
      annualizedReturnPercent: 60,
      averageEquity: 10_250,
      peakEquity: 10_600,
      peakEquityDate: '2024-01-14',
      troughEquity: 10_100,
      troughEquityDate: '2024-01-10',
      leverageUtilization: 0.5,
      marginUtilizationPercent: 5,
      cashUtilizationPercent: 10,
      profitFactor: 1.8,
      recoveryFactor: 3.0,
      payoffRatio: 2.0,
    },

    tradeSummary: {
      totalTrades: 10,
      winningTrades: 6,
      losingTrades: 4,
      breakEvenTrades: 0,
      winRate: 0.6,
      lossRate: 0.4,
      averageTrade: 50,
      medianTrade: 40,
      largestWin: 200,
      largestLoss: -100,
      averageWin: 133,
      averageLoss: -75,
      profitFactor: 1.8,
      expectancy: 50,
      payoffRatio: 1.77,
      riskRewardRatio: 0.56,
      maxConsecutiveWins: 4,
      maxConsecutiveLosses: 2,
      averageHoldingTimeMs: 3_600_000,
      averageHoldingTimeFormatted: '1h',
      maxHoldingTimeMs: 14_400_000,
      minHoldingTimeMs: 300_000,
      tradeFrequencyPerDay: 10,
      tradeFrequencyPerWeek: 70,
      longestFlatPeriodMs: 7_200_000,
      longestFlatPeriodFormatted: '2h',
      firstTradeAt: 1_700_000_000_000,
      lastTradeAt: 1_700_080_000_000,
    },

    riskMetrics: {
      sharpeRatio: 1.5,
      sortinoRatio: 2.0,
      calmarRatio: 3.0,
      omegaRatio: 1.8,
      treynorRatio: 0.1,
      informationRatio: 0.5,
      maxDrawdown: 0.05,
      maxDrawdownPercent: 5,
      maxDrawdownAbsolute: 500,
      averageDrawdown: 0.02,
      ulcerIndex: 0.03,
      painIndex: 0.01,
      rolling7dSharpe: 1.2,
      rolling30dSharpe: 1.1,
      rolling90dSharpe: 1.0,
      rolling7dSortino: 1.8,
      rolling30dSortino: 1.7,
      rolling90dSortino: 1.6,
      rolling7dReturnPercent: 2,
      rolling30dReturnPercent: 8,
      rolling90dReturnPercent: 20,
      rolling180dReturnPercent: 35,
      rolling365dReturnPercent: 60,
      daily7dVolatility: 0.01,
      daily30dVolatility: 0.012,
      annualizedVolatility: 0.19,
    },

    drawdownAnalysis: {
      isInDrawdown: false,
      currentDrawdownPercent: 0,
      currentDrawdownAbsolute: 0,
      drawdownStartDate: null,
      maxDrawdownPercent: 5,
      maxDrawdownAbsolute: 500,
      averageDrawdownPercent: 2,
      ulcerIndex: 0.03,
      painIndex: 0.01,
      averageRecoveryMs: 86_400_000,
      longestDrawdownMs: 172_800_000,
      totalDrawdownPeriods: 2,
      top5Drawdowns: [],
    },

    strategyComparison: null,

    executionQuality: {
      averageSlippage: 1,
      medianSlippage: 0.5,
      worstSlippage: 10,
      totalSlippage: 10,
      slippageAsPercentOfPnl: 0.02,
      averageLatencyMs: 5,
      medianLatencyMs: 4,
      p95LatencyMs: 12,
      maxLatencyMs: 30,
      orderFillRate: 0.98,
      cancelRate: 0.01,
      partialFillRate: 0.01,
      rejectedOrderRate: 0,
      totalFills: 20,
      totalCommission: 20,
      commissionAsPercentOfPnl: 0.04,
      executionScore: 88,
    },

    exposureAnalysis: {
      grossExposure: 5_000,
      netExposure: 2_000,
      longExposure: 3_500,
      shortExposure: 1_500,
      leverageUtilization: 0.5,
      marginUtilizationPercent: 5,
      cashUtilizationPercent: 10,
      openPositionCount: 3,
      longPositionCount: 2,
      shortPositionCount: 1,
      topSymbolsByExposure: [
        {
          symbol: 'BTCUSDT',
          direction: 'LONG',
          notional: 2_000,
          percentOfEquity: 0.19,
          unrealizedPnl: 50,
        },
      ],
      exposureByStrategy: [],
    },

    recommendations: {
      items: [
        {
          priority: RecommendationPriority.HIGH,
          category: RecommendationCategory.RISK,
          message: 'Test alert',
          dataPoint: 'Sharpe: 0.1',
        },
      ],
      riskAlerts: ['Test alert'],
      totalItems: 1,
      highPriorityCount: 1,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
    },

    charts: {
      equityCurve: [{ timestamp: 1_700_000_000_000, date: '2024-01-15', value: 10_500 }],
      balanceCurve: [],
      drawdownCurve: [],
      rollingSharpe: [],
      rollingVolatility: [],
      monthlyReturns: [
        { year: 2024, month: 1, label: 'Jan 2024', returnPercent: 5, isProfit: true },
      ],
      tradeDistribution: [
        { label: '[0, 100)', rangeMin: 0, rangeMax: 100, count: 6, frequency: 0.6 },
      ],
      pnlDistribution: [],
      holdingTimeDistribution: [],
    },

    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('MarkdownReportExporterService', () => {
  let service: MarkdownReportExporterService;

  beforeEach(() => {
    service = new MarkdownReportExporterService();
  });

  describe('export()', () => {
    it('returns a non-empty string', () => {
      const md = service.export(makeReport());
      expect(typeof md).toBe('string');
      expect(md.length).toBeGreaterThan(100);
    });

    it('includes the report title as an H1', () => {
      const md = service.export(makeReport());
      expect(md).toContain('# ');
      expect(md).toContain('Daily Report');
    });

    it('includes all 8 major section headings', () => {
      const md = service.export(makeReport());
      expect(md).toContain('## Executive Summary');
      expect(md).toContain('## Portfolio Performance');
      expect(md).toContain('## Trade Summary');
      expect(md).toContain('## Risk Metrics');
      expect(md).toContain('## Drawdown Analysis');
      expect(md).toContain('## Execution Quality');
      expect(md).toContain('## Exposure Analysis');
      expect(md).toContain('## Recommendations');
    });

    it('includes the net P&L value', () => {
      const md = service.export(makeReport());
      expect(md).toContain('+500.00');
    });

    it('shows "Not in drawdown" when not in drawdown', () => {
      const md = service.export(makeReport());
      expect(md).toContain('🟢 **Not in drawdown**');
    });

    it('shows "In Drawdown" when in drawdown', () => {
      const report = makeReport({
        drawdownAnalysis: {
          isInDrawdown: true,
          currentDrawdownPercent: 8,
          currentDrawdownAbsolute: 800,
          drawdownStartDate: '2024-01-12',
          maxDrawdownPercent: 10,
          maxDrawdownAbsolute: 1_000,
          averageDrawdownPercent: 4,
          ulcerIndex: 0.05,
          painIndex: 0.03,
          averageRecoveryMs: 0,
          longestDrawdownMs: 0,
          totalDrawdownPeriods: 1,
          top5Drawdowns: [],
        },
      });
      const md = service.export(report);
      expect(md).toContain('🔴 **In Drawdown**');
      expect(md).toContain('2024-01-12');
    });

    it('includes highlights in the header', () => {
      const md = service.export(makeReport());
      expect(md).toContain('Net P&L: +500.00');
    });

    it('shows risk alerts in the recommendations section', () => {
      const md = service.export(makeReport());
      expect(md).toContain('Test alert');
    });

    it('includes execution score', () => {
      const md = service.export(makeReport());
      expect(md).toContain('88/100');
    });

    it('includes strategy comparison section when present', () => {
      const report = makeReport({
        strategyComparison: {
          strategies: [
            {
              strategyId: 'A',
              strategyLabel: 'Momentum',
              netProfit: 500,
              totalReturnPercent: 5,
              annualizedReturnPercent: 60,
              sharpeRatio: 1.5,
              sortinoRatio: 2.0,
              calmarRatio: 3.0,
              maxDrawdownPercent: 5,
              totalTrades: 10,
              winRate: 0.6,
              expectancy: 50,
              profitFactor: 1.8,
            },
            {
              strategyId: 'B',
              strategyLabel: 'Mean Revert',
              netProfit: 300,
              totalReturnPercent: 3,
              annualizedReturnPercent: 36,
              sharpeRatio: 0.9,
              sortinoRatio: 1.2,
              calmarRatio: 1.5,
              maxDrawdownPercent: 8,
              totalTrades: 15,
              winRate: 0.5,
              expectancy: 20,
              profitFactor: 1.4,
            },
          ],
          bestByReturn: 'A',
          bestBySharpe: 'A',
          bestBySortino: 'A',
          bestByCalmar: 'A',
          bestByDrawdown: 'A',
          bestByExpectancy: 'A',
          bestByProfitFactor: 'A',
        },
      });
      const md = service.export(report);
      expect(md).toContain('## Strategy Comparison');
      expect(md).toContain('Momentum');
      expect(md).toContain('Mean Revert');
    });

    it('omits strategy comparison section when null', () => {
      const md = service.export(makeReport({ strategyComparison: null }));
      expect(md).not.toContain('## Strategy Comparison');
    });

    it('includes report metadata in the footer', () => {
      const md = service.export(makeReport());
      expect(md).toContain('rpt_test');
      expect(md).toContain('42ms');
    });

    it('shows "No issues detected" when no recommendations', () => {
      const report = makeReport({
        recommendations: {
          items: [],
          riskAlerts: [],
          totalItems: 0,
          highPriorityCount: 0,
          mediumPriorityCount: 0,
          lowPriorityCount: 0,
        },
      });
      const md = service.export(report);
      expect(md).toContain('No issues detected');
    });

    it('includes monthly return data', () => {
      const md = service.export(makeReport());
      expect(md).toContain('Jan 2024');
    });

    it('includes symbol exposure data', () => {
      const md = service.export(makeReport());
      expect(md).toContain('BTCUSDT');
    });

    it('produces valid Markdown table syntax', () => {
      const md = service.export(makeReport());
      // Tables should have header separator rows: |---|---|
      expect(md).toMatch(/\|[- |]+\|/);
    });
  });

  describe('profit/loss rendering', () => {
    it('shows green emoji for profitable report', () => {
      const md = service.export(
        makeReport({ executiveSummary: { ...makeReport().executiveSummary, isProfit: true } }),
      );
      expect(md).toContain('🟢');
    });

    it('shows red emoji for losing report', () => {
      const report = makeReport({
        executiveSummary: { ...makeReport().executiveSummary, isProfit: false, netPnl: -200 },
      });
      const md = service.export(report);
      expect(md).toContain('🔴');
    });
  });

  describe('large portfolios — does not crash', () => {
    it('handles many top drawdown periods', () => {
      const ddPeriods = Array.from({ length: 5 }, (_, i) => ({
        rank: i + 1,
        startDate: '2024-01-01',
        troughDate: '2024-01-05',
        endDate: '2024-01-10',
        depthPercent: 0.05 + i * 0.01,
        depthAbsolute: 500 + i * 100,
        equityAtPeak: 10_000,
        equityAtTrough: 9_500 - i * 100,
        durationMs: 4 * 86_400_000,
        recoveryMs: 5 * 86_400_000,
      }));
      const report = makeReport({
        drawdownAnalysis: { ...makeReport().drawdownAnalysis, top5Drawdowns: ddPeriods },
      });
      const md = service.export(report);
      expect(md).toContain('### Top Drawdowns');
      expect(md).toContain('| 1');
      expect(md).toContain('| 5');
    });
  });
});
