# Reporting Engine — Architecture & Developer Guide

## Overview

The Reporting Engine (Milestone 27) generates professional, automated trading reports for Backtest, Paper Trading, and Live Trading modes. It reads from the Analytics Engine (Milestone 26) and produces versioned, archived reports in multiple formats.

Reports cover daily, weekly, monthly, quarterly, yearly, and custom date ranges, and include nine structured sections, nine chart-data payloads, strategy comparison, and automated recommendations.

---

## Module Location

```
src/modules/reporting/
```

Registered in `AppModule` after `AnalyticsModule`.

---

## Architecture

```
ReportingModule
│
├── domain/                     Pure models — no NestJS dependencies
│   ├── enums/
│   │   ├── report-period.enum.ts        DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY | CUSTOM
│   │   ├── report-source.enum.ts        BACKTEST | PAPER | LIVE | MULTI_SOURCE
│   │   ├── report-export-format.enum.ts JSON | CSV | MARKDOWN
│   │   └── report-status.enum.ts        PENDING | GENERATING | COMPLETE | FAILED
│   ├── models/
│   │   ├── report.model.ts              TradingReport (full) + ReportSummary (lightweight)
│   │   ├── report-config.model.ts       ReportConfig (generation input)
│   │   ├── strategy-comparison-result.model.ts
│   │   ├── sections/                    One interface per report section (9 total)
│   │   └── charts/report-charts.model.ts  ReportCharts (9 chart-data payloads)
│   └── errors/reporting.errors.ts
│
├── application/
│   ├── builders/               Stateless pure builders (one per section + chart data)
│   │   ├── executive-summary.builder.ts
│   │   ├── portfolio-performance.builder.ts
│   │   ├── trade-summary.builder.ts
│   │   ├── risk-section.builder.ts
│   │   ├── drawdown-analysis.builder.ts
│   │   ├── execution-quality.builder.ts
│   │   ├── exposure-analysis.builder.ts
│   │   ├── recommendations.builder.ts
│   │   └── chart-data.builder.ts
│   ├── exporters/              Serialisation (no file I/O)
│   │   ├── json-report-exporter.service.ts
│   │   ├── csv-report-exporter.service.ts
│   │   └── markdown-report-exporter.service.ts
│   ├── services/
│   │   ├── report-generator.service.ts   Main orchestrator
│   │   ├── report-scheduler.service.ts   Daily/weekly/monthly auto-generation
│   │   └── strategy-comparator.service.ts
│   └── storage/
│       └── report-storage.service.ts     Redis-backed persistence & versioning
│
└── reporting.module.ts
```

---

## Data Flow

```
ReportConfig (input)
       │
       ▼
ReportGeneratorService
  ├── Validate config
  ├── Resolve period dates  ──────────────────────────────────┐
  ├── AnalyticsStorageService.loadSnapshotsByRange()          │  Read-only from
  ├── AnalyticsDataCollectorService.collectTrades()           │  Analytics Engine
  │                                                           └──────────────────
  ├── 9 section builders (run synchronously, pure functions)
  ├── ChartDataBuilder.build()
  ├── StrategyComparatorService.compare()  (when ≥ 2 strategies)
  ├── ReportStorageService.nextVersion()   (stable ID + increment version)
  ├── Assemble TradingReport
  └── ReportStorageService.save()

TradingReport (output) ──► Exporters (JSON / CSV / Markdown)
                       └──► Redis storage (versioned)
```

---

## Report Types

### Period Types

| Period | Covers | Trigger |
|--------|--------|---------|
| `DAILY` | One calendar day (00:00–23:59 UTC) | Auto at 23:50 UTC |
| `WEEKLY` | Mon–Sun ISO week | Auto on Sunday 23:55 UTC |
| `MONTHLY` | Calendar month | Auto on last day of month |
| `QUARTERLY` | Q1–Q4 calendar quarters | Manual trigger |
| `YEARLY` | Calendar year | Manual trigger |
| `CUSTOM` | Any `fromMs`–`toMs` range | Manual trigger |

### Source Types

| Source | Data Origin |
|--------|-------------|
| `PAPER` | PaperTradingModule (live market simulation, no real capital) |
| `BACKTEST` | BacktestEngine output |
| `LIVE` | Real exchange orders |
| `MULTI_SOURCE` | Combined cross-source comparison |

---

## Report Sections

| # | Section | Key Metrics |
|---|---------|-------------|
| 1 | **Executive Summary** | Net P&L, Return %, Sharpe, Max DD, Win Rate — headline numbers |
| 2 | **Portfolio Performance** | Capital, P&L attribution, return ratios, equity curve stats |
| 3 | **Trade Summary** | Counts, per-trade P&L, streaks, holding time, frequency |
| 4 | **Risk Metrics** | Sharpe/Sortino/Calmar/Omega, rolling ratios, volatility |
| 5 | **Drawdown Analysis** | Current state, top-5 worst periods, recovery stats |
| 6 | **Strategy Comparison** | Side-by-side table with winners per metric (multi-strategy only) |
| 7 | **Execution Quality** | Slippage, latency, fill rate, commission, execution score (0–100) |
| 8 | **Exposure Analysis** | Gross/net/long/short exposure, leverage, top positions |
| 9 | **Recommendations** | Rule-based insights with priority (HIGH/MEDIUM/LOW) and category |

---

## Chart Data Payloads

All chart data is **raw numbers only** — no rendering. Consumers (dashboard, UI, PDF generator) handle display.

| Chart | Type | Description |
|-------|------|-------------|
| `equityCurve` | Time series | Portfolio equity at each daily observation |
| `balanceCurve` | Time series | Cash balance (excludes unrealised P&L) |
| `drawdownCurve` | Time series | Peak-to-current drawdown at each daily observation |
| `rollingSharpe` | Time series | 30-day rolling Sharpe ratio |
| `rollingVolatility` | Time series | 30-day rolling annualised volatility |
| `monthlyReturns` | Heatmap | Monthly return % per calendar month |
| `tradeDistribution` | Histogram | Per-trade P&L distribution (20 buckets) |
| `pnlDistribution` | Histogram | Daily P&L change distribution |
| `holdingTimeDistribution` | Histogram | Trade holding time distribution (10 buckets) |

---

## Export Formats

### JSON
```typescript
// Full report — structured, pretty-printed
const json = jsonExporter.export(report);

// Compact (transport/archival)
const compact = jsonExporter.exportCompact(report);

// Summary only (index listing)
const summary = jsonExporter.exportSummary(report);
```

### CSV
```typescript
// All sections → Map<filename, csv>
const files = csvExporter.exportAll(report);
// files.get('paper_daily_2024-01-15_v1_executive_summary.csv')

// Single section
const executiveCsv = csvExporter.exportExecutiveSummary(report);
const equityCsv = csvExporter.exportEquityCurve(report);
```

### Markdown
```typescript
// Full single-document report
const md = markdownExporter.export(report);
```

**Future:** PDF (headless browser render) and HTML (self-contained page) are planned but not yet implemented.

---

## Scheduling

The `ReportSchedulerService` registers three recurring tasks on module init using the platform's `TaskScheduler`:

| Task | Frequency | UTC Time | Formats |
|------|-----------|----------|---------|
| `daily-report` | Every 24h | 23:50 | JSON + Markdown + CSV |
| `weekly-report` | Every Sunday | 23:55 | JSON + Markdown + CSV |
| `monthly-report` | Last day of month | 23:55 | JSON + Markdown + CSV |

### Manual trigger
```typescript
// Inject ReportSchedulerService then:
await scheduler.generateNow(ReportPeriod.QUARTERLY, ReportSource.PAPER);
await scheduler.generateNow(ReportPeriod.CUSTOM, ReportSource.BACKTEST,
  'my-session', ['strat-A', 'strat-B'], [ReportExportFormat.JSON], /* fromMs, toMs */
);
```

---

## Strategy Comparison

When `config.strategyIds` contains **2 or more** strategy IDs, the generator calls `StrategyComparatorService.compare()` and populates `report.strategyComparison`.

```typescript
const config: ReportConfig = {
  period:      ReportPeriod.MONTHLY,
  source:      ReportSource.PAPER,
  sessionId:   'paper_trading_default',
  strategyIds: ['momentum-v2', 'mean-revert-v1', 'breakout-v3'],
  formats:     [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN],
};
const report = await generator.generate(config);

// report.strategyComparison.bestBySharpe === 'momentum-v2'
```

The comparison table ranks by: Return, Sharpe, Sortino, Calmar, Drawdown (lowest wins), Expectancy, Profit Factor.

---

## Persistence & Versioning

Reports are stored in Redis with full versioning.

### Storage layout
```
reports:all              → Sorted Set (score = generatedAt unix ms, member = reportId)
reports:report:{id}      → String (JSON of latest version)
reports:versions:{id}:{v}→ String (JSON of specific version)
reports:index            → List of ReportSummary JSON (newest first, max 365)
reports:version-counter:{id} → Integer (monotonic version counter)
```

### reportId stability

The `reportId` is derived **deterministically** from `period + source + sessionId + strategyIds`. Re-generating the same report increments the version counter rather than creating a new ID. This means:

- Daily report for 2024-01-15 always has the same `reportId`
- First generation → `version: 1`
- Re-generation (e.g. after more data arrives) → `version: 2`
- Historical versions remain accessible via `reportStorage.loadVersion(reportId, version)`

### Retention
- Up to **365 reports** are retained (configurable via `MAX_REPORTS`)
- Oldest are evicted automatically
- All versions of a specific report are retained as long as the report is in the index

---

## Recommendations Engine

The `RecommendationsBuilder` applies rule-based threshold checks to produce prioritised recommendations:

| Rule | Threshold | Priority | Category |
|------|-----------|----------|----------|
| Sharpe < 0 | Negative | HIGH | RISK |
| Sharpe < 0.5 | Critically low | HIGH | RISK |
| Sharpe 0.5–1.0 | Below target | MEDIUM | PERFORMANCE |
| Max DD > 20% | Excessive | HIGH | RISK |
| Max DD 10–20% | Elevated | MEDIUM | RISK |
| Profit Factor < 1.0 | Unprofitable | HIGH | PERFORMANCE |
| Profit Factor 1.0–1.2 | Marginal edge | MEDIUM | PERFORMANCE |
| Expectancy < 0 | Losing strategy | HIGH | PERFORMANCE |
| Fill Rate < 90% | Execution issue | MEDIUM/HIGH | EXECUTION |
| Slippage > 5% of P&L | High slippage | MEDIUM/HIGH | EXECUTION |
| Gross Exposure > 100% equity | Over-leveraged | MEDIUM/HIGH | EXPOSURE |

`HIGH` RISK recommendations are also surfaced in `report.recommendations.riskAlerts` for dashboard display.

---

## Generating a Report Programmatically

```typescript
import { ReportGeneratorService } from '@modules/reporting/application/services/report-generator.service';
import { MarkdownReportExporterService } from '@modules/reporting/application/exporters/markdown-report-exporter.service';
import { ReportPeriod, ReportSource, ReportExportFormat } from '@modules/reporting/domain/enums';

// Inject services (NestJS DI)
const report = await generator.generate({
  period:      ReportPeriod.WEEKLY,
  source:      ReportSource.PAPER,
  sessionId:   'paper_trading_default',
  strategyIds: [],
  formats:     [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN],
  referenceDate: '2024-01-15',  // any date within the target week
});

const md = markdownExporter.export(report);
console.log(md);
```

---

## Querying Historical Reports

```typescript
import { ReportStorageService } from '@modules/reporting/application/storage/report-storage.service';

// Last 20 reports (any period/source)
const recent = await storage.loadLatest(20);

// Reports within a time window
const weekly = await storage.loadByRange(fromMs, toMs);

// Lightweight index for listing
const index = await storage.loadIndex(100);
// index[0].title, index[0].netProfit, index[0].sharpeRatio, ...

// A specific report
const report = await storage.loadById('rpt_abc123');

// A specific version
const v1 = await storage.loadVersion('rpt_abc123', 1);
```

---

## Testing

Four test suites cover the core components:

| Suite | File | Coverage |
|-------|------|----------|
| `ReportGeneratorService` | `tests/unit/reporting/report-generator.service.spec.ts` | Period resolution, validation, section assembly, storage, fallbacks |
| `StrategyComparatorService` | `tests/unit/reporting/strategy-comparator.service.spec.ts` | Winner selection, snapshot matching, error handling, 3-strategy scenarios |
| `MarkdownReportExporterService` | `tests/unit/reporting/markdown-report-exporter.service.spec.ts` | Section headings, data values, strategy comparison, large portfolios |
| `ReportStorageService` | `tests/unit/reporting/report-storage.service.spec.ts` | Save/load lifecycle, versioning, index, Redis fault tolerance |

```bash
pnpm test:unit -- --testPathPattern=tests/unit/reporting
```

---

## Design Principles

1. **Read-only from analytics** — the reporting engine never modifies analytics snapshots, strategy state, or paper trading state.

2. **Builders are pure** — all section builders are stateless functions of `AnalyticsSnapshot`. They have no I/O, no side effects.

3. **Storage failures never crash** — all `ReportStorageService` methods catch errors internally. A storage failure produces a log entry, not a process crash.

4. **Versioned, not mutated** — reports are immutable once generated. Re-generation produces a new version at the same stable ID.

5. **No rendering** — chart data is raw arrays of numbers. Rendering is the consumer's responsibility.

6. **Scheduler is replaceable** — the in-process `TaskScheduler` is sufficient for single-instance deployments. For distributed/persistent scheduling, swap `ReportSchedulerService` for a BullMQ-backed implementation without changing any other class.
