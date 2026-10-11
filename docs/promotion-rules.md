# Promotion Pipeline Rules

> **Milestone 34** — No stage may be skipped. Read this before promoting any experiment.

## Overview

An experiment progresses through seven ordered stages before reaching production. Skipping any stage is a hard error — the pipeline enforces ordering via numeric stage weights and throws `ResearchPromotionStageMissingError` if an attempt is made.

```
RESEARCH → VALIDATION → WALK_FORWARD → MONTE_CARLO
  → PAPER_TRADING → MANUAL_APPROVAL → PRODUCTION
```

Terminal states (no further advancement possible):
- **PRODUCTION** — experiment is live; use the production decommission workflow to retire it.
- **REJECTED** — experiment will not advance further; can be rejected from any stage.

---

## Stage Definitions

| Stage            | Order | Description                                                   |
|------------------|-------|---------------------------------------------------------------|
| RESEARCH         | 0     | Experiment exists in the sandbox. Initial backtesting.        |
| VALIDATION       | 1     | In-sample validation: hold-out period backtest.               |
| WALK_FORWARD     | 2     | Walk-forward testing across multiple out-of-sample windows.   |
| MONTE_CARLO      | 3     | Monte Carlo stress testing for robustness and path-dependence.|
| PAPER_TRADING    | 4     | Live paper trading: real market data, simulated fills.        |
| MANUAL_APPROVAL  | 5     | Human review required. No automatic approval possible.        |
| PRODUCTION       | 6     | Deployed to live production with real capital.                |

---

## Automatic Metric Thresholds

Each stage enforces minimum metric thresholds. If the experiment fails to meet the threshold, `promote()` returns `StageValidationResult.passed = false` without advancing the stage.

| Target Stage   | Metric Checked             | Threshold            | Direction       |
|----------------|----------------------------|----------------------|-----------------|
| VALIDATION     | `sharpeRatio`              | ≥ 0.5                | Higher is better |
| WALK_FORWARD   | `maxDrawdownPercent`       | ≤ 35%                | Lower is better  |
| MONTE_CARLO    | `maxDrawdownPercent`       | ≤ 40%                | Lower is better  |
| MONTE_CARLO    | `sharpeRatio`              | ≥ 0.5                | Higher is better |
| PAPER_TRADING  | `winRate`                  | ≥ 45%                | Higher is better |
| PAPER_TRADING  | `sharpeRatio`              | ≥ 0.8                | Higher is better |
| MANUAL_APPROVAL| (human decision)           | —                    | —               |
| PRODUCTION     | (requires approval token)  | —                    | —               |

> **Note**: Thresholds are conservative defaults. They may be tuned by modifying the constants at the top of `promotion-pipeline.service.ts`.

---

## Statistical Significance Prerequisite

**All forward promotions** require the experiment to be statistically valid:

```
pValue < 0.05  (one-tailed Welch t-test, H₀: mean return = 0)
```

If `experiment.metrics.isStatisticallyValid === false`, promoting throws `ResearchStatisticalValidationError` immediately — before stage-specific metric checks run. This ensures that no experiment with returns indistinguishable from random noise can advance.

---

## Promoting an Experiment

```typescript
const result = await promotionPipeline.promote({
  experimentId: 'exp-001',
  targetStage: PromotionStage.VALIDATION,
  initiatedBy: 'researcher@example.com',
  reason: 'Backtest Sharpe 1.8, MaxDD 12%, p=0.02. Ready for hold-out validation.',
  requestedAt: new Date(),
});

if (!result.passed) {
  console.error(`Promotion blocked: ${result.notes}`);
  // Do NOT retry — fix the underlying issue first.
}
```

---

## MANUAL_APPROVAL → PRODUCTION (Special Case)

The final stage transition requires a **production approval token** as an explicit human confirmation that live capital will be at risk. This is a second-factor confirmation — not a password.

**Token format**: `APPROVE-PRODUCTION-{experimentId}`

```typescript
await promotionPipeline.promote({
  experimentId: 'exp-001',
  targetStage: PromotionStage.PRODUCTION,
  initiatedBy: 'quant-lead@example.com',
  reason: '6 weeks paper trading. Sharpe 1.4, MaxDD 8%. Approved by risk committee.',
  productionApprovalToken: 'APPROVE-PRODUCTION-exp-001',  // ← required
  requestedAt: new Date(),
});
```

Missing or incorrect token throws `ResearchProductionContaminationError`.

> ⚠️ **PRODUCTION promotion only records the decision in the research sandbox.** Actual deployment to the live execution engine is a separate operational step performed by platform operators using the production deployment workflow. The sandbox cannot start live trading on its own.

---

## Rejecting an Experiment

An experiment can be rejected from any non-terminal stage:

```typescript
await promotionPipeline.reject(
  'exp-001',
  'researcher@example.com',
  'Walk-forward showed 50% drawdown. Strategy is not robust.',
);
```

**Rejecting a PRODUCTION experiment is forbidden** — use the production decommission workflow instead. Attempting to reject a live experiment via this API throws `ResearchProductionContaminationError`.

---

## Promotion History

Every promotion and rejection is recorded as an immutable audit log:

```typescript
const history = await promotionPipeline.getPromotionHistory('exp-001');
// Returns PromotionRecord[]
// [
//   { fromStage: 'RESEARCH', toStage: 'VALIDATION', initiatedBy: '...', approvedAt: Date },
//   { fromStage: 'VALIDATION', toStage: 'WALK_FORWARD', ... },
//   ...
// ]
```

Records are stored in Redis as a list (`research:promotions:{id}`) and never deleted.

---

## Error Reference

| Error                                | Cause                                                       |
|--------------------------------------|-------------------------------------------------------------|
| `ResearchExperimentNotFoundError`    | Experiment ID does not exist                                |
| `ResearchInvalidPromotionStageError` | Targeting a past stage, the same stage, or a terminal state |
| `ResearchPromotionStageMissingError` | Attempting to skip a stage (e.g. RESEARCH → WALK_FORWARD)  |
| `ResearchStatisticalValidationError` | p ≥ 0.05 — returns not statistically significant            |
| `ResearchProductionContaminationError` | Missing/wrong approval token, or rejecting a PRODUCTION exp |

---

## Decision Checklist

Before calling `promote()`:

- [ ] Experiment status is `COMPLETED` (not PENDING / RUNNING / FAILED)
- [ ] `metrics.isStatisticallyValid === true` (p < 0.05)
- [ ] Stage-specific metrics meet the threshold (see table above)
- [ ] Target stage is exactly the next stage in the pipeline
- [ ] For PRODUCTION: approval token generated and reviewed by a second person
- [ ] `reason` field documents the rationale clearly for the audit log
