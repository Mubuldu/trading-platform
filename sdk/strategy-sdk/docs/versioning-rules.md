# Strategy SDK — Versioning Policy

> **Version:** 1.0.0

---

## Table of Contents

1. [Semantic Versioning](#semantic-versioning)
2. [API Stability Tiers](#api-stability-tiers)
3. [What Constitutes a Breaking Change](#what-constitutes-a-breaking-change)
4. [Strategy `requiredSdkVersion` Rules](#strategy-requiredsdk-version-rules)
5. [Compatibility Matrix](#compatibility-matrix)
6. [Deprecation Process](#deprecation-process)
7. [Pre-release Versions](#pre-release-versions)

---

## Semantic Versioning

The SDK follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Component | Incremented when … |
|---|---|
| **MAJOR** | A breaking change is introduced in a Stable-tier interface |
| **MINOR** | New functionality is added in a backward-compatible way |
| **PATCH** | Backward-compatible bug fixes or documentation corrections |

Current SDK version: **`1.0.0`** (see `SDK_API_VERSION` in `src/version.ts`)

---

## API Stability Tiers

Every exported symbol is classified into one of three stability tiers. Tier changes are announced in the changelog.

### Stable

Covered by the full semver contract. Breaking changes require a MAJOR bump and a minimum **90-day deprecation window**.

Examples: `SdkStrategy`, `PluginManifest`, `SdkStrategyContext`, `SdkSignal`, `StrategyPermission`, `sdkOk`, `sdkErr`.

### Experimental

Breaking changes may occur in a MINOR release. Symbols are marked `@experimental` in JSDoc. Strategies depending on experimental APIs should pin an exact SDK version.

Examples: Any interface marked `@experimental` in the type definitions.

### Internal

Not part of the public API. May change at any time without notice. Symbols are prefixed with an underscore or live in `internal/` subpaths. Strategies must never import from these paths.

---

## What Constitutes a Breaking Change

The following modifications require a MAJOR version bump (after the deprecation window):

**Removed or renamed exports**
- Removing an interface, class, type alias, or function from the public API
- Renaming a Stable-tier export without an alias

**Incompatible interface changes**
- Adding a required property to an existing interface (strategies would fail to implement it)
- Removing a property from a context interface strategies already depend on
- Changing the type of an existing property in a way that breaks valid callers

**Behavioural contracts**
- Changing the semantics of an existing hook (e.g. `onWarmup` now called before `onInitialize`)
- Changing what `null` means in a context field

**The following are NOT breaking changes** (MINOR or PATCH):
- Adding optional fields to an existing interface
- Adding new optional hooks to `SdkStrategy`
- Adding new `StrategyPermission` values (existing strategies simply won't request them)
- Improving error messages
- Adding new exports without removing existing ones

---

## Strategy `requiredSdkVersion` Rules

The `manifest.requiredSdkVersion` field tells the platform which SDK versions your strategy was designed for. The platform validates it on install.

### Allowed range formats

| Format | Example | Meaning |
|---|---|---|
| Caret `^` | `^1.0.0` | Compatible with same major; any `>=1.0.0 <2.0.0` |
| Tilde `~` | `~1.2.0` | Same major.minor; any `>=1.2.0 <1.3.0` |
| GTE | `>=1.0.0` | Any version >= 1.0.0 |
| Compound | `>=1.0.0 <2.0.0` | Explicit range |
| Exact | `1.0.0` | Only exactly 1.0.0 |

### Rejected formats

| Format | Reason |
|---|---|
| `*` | Too broad — cannot guarantee compatibility |
| `x` or `X` | Same as wildcard |
| `latest` | Not a version specifier |
| `1.0` | Missing patch component — not valid semver |

### Recommended practice

Use a caret range matching the MAJOR version you developed against:

```json
"requiredSdkVersion": "^1.0.0"
```

This allows the platform to update the SDK through the `1.x` series without breaking your strategy. Only tighten to an exact or tilde range if you depend on Experimental-tier APIs that changed in a MINOR release.

---

## Compatibility Matrix

The `VersionCompatibilityChecker` class (exported from the SDK) performs the check at install time. The platform's installed SDK version is compared against the strategy's `requiredSdkVersion`.

```typescript
// At install time
const compatible = VersionCompatibilityChecker.isCompatible(manifest.requiredSdkVersion);
if (!compatible) {
  const reason = VersionCompatibilityChecker.incompatibilityReason(manifest.requiredSdkVersion);
  // Installation blocked
}
```

### What the checker does

1. Rejects wildcards (`*`, `x`, `X`) unconditionally
2. Parses the range into `{ operator, major, minor, patch }` segments
3. Compares segment-by-segment against `SDK_API_VERSION`
4. Compound ranges (space-separated) must all be satisfied simultaneously

### Decision table (SDK `1.0.0`)

| `requiredSdkVersion` | Compatible? |
|---|---|
| `1.0.0` | ✅ |
| `^1.0.0` | ✅ |
| `~1.0.0` | ✅ |
| `>=1.0.0` | ✅ |
| `>=1.0.0 <2.0.0` | ✅ |
| `^2.0.0` | ❌ — major mismatch |
| `~1.1.0` | ❌ — minor mismatch |
| `*` | ❌ — wildcard |
| `not-a-version` | ❌ — malformed |

---

## Deprecation Process

Before removing or breaking a Stable-tier API:

1. **Announce** in the changelog and release notes
2. **Mark deprecated** with `@deprecated` JSDoc and a replacement note
3. **90-day window** — the symbol remains functional for at least one full MINOR release cycle
4. **MAJOR bump** — the symbol is removed in the next MAJOR release

Strategies that depend on a deprecated symbol will receive a validation warning during install. They continue to work until the MAJOR bump.

Example deprecation notice (in source):

```typescript
/**
 * @deprecated since 1.2.0 — use `ReadonlyMarketData.lastPrice()` instead.
 * Will be removed in 2.0.0.
 */
export function getLastPrice(ctx: SdkStrategyContext): number | null { … }
```

---

## Pre-release Versions

Pre-release SDK versions (e.g. `1.1.0-beta.1`, `2.0.0-rc.2`) are published to the internal package registry for early testing. They are **not** accepted in `requiredSdkVersion` ranges in production environments.

To test against a pre-release SDK, pin the exact pre-release version in your dev environment's `package.json`; do not include it in your manifest's `requiredSdkVersion`.
