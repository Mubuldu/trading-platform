# Strategy SDK — Security Model

> **Version:** 1.0.0

---

## Table of Contents

1. [Threat Model](#threat-model)
2. [Current Isolation Boundaries](#current-isolation-boundaries)
3. [Static Security Scan](#static-security-scan)
4. [Permission System](#permission-system)
5. [Resource Limits](#resource-limits)
6. [What Strategies Cannot Do](#what-strategies-cannot-do)
7. [Trusted vs. Untrusted Strategies](#trusted-vs-untrusted-strategies)
8. [Future: Worker Thread Isolation](#future-worker-thread-isolation)
9. [Incident Response](#incident-response)

---

## Threat Model

The plugin system must protect against:

| Threat | Description |
|---|---|
| **Data exfiltration** | A strategy reads platform secrets (API keys, account data) and sends them to an external server |
| **Market manipulation** | A strategy generates signals designed to move the market, not to profit the account |
| **Resource exhaustion** | A strategy consumes unbounded CPU, memory, or network, starving other strategies and the core engine |
| **Privilege escalation** | A strategy accesses platform internals beyond what its declared permissions allow |
| **Code injection** | A strategy uses `eval`, `new Function`, or dynamic `require`/`import` to load arbitrary code at runtime |
| **File system access** | A strategy reads sensitive files (e.g. private keys, `.env`) from the host |

The SDK is not designed to run untrusted, adversarial code. It targets **trusted-but-fallible** strategy authors—developers who may make mistakes but are not deliberately malicious.

---

## Current Isolation Boundaries

The platform enforces three layers of protection at plugin execution time:

### Layer 1 — Static validation (`PluginValidationService`)

Before installation, the service runs four sequential checks:

1. **Manifest validation** — `validateManifest()` from the SDK; checks schema, semver, permissions, dependencies
2. **SDK version compatibility** — `VersionCompatibilityChecker.isCompatible()` against the installed SDK version
3. **Security scan** — text scan of `strategy.constructor.toString()` for blocked API patterns
4. **Permission validation** — all declared permissions must be valid `StrategyPermission` members

#### Blocked API patterns (security scan)

```typescript
const BLOCKED_API_PATTERNS = [
  'process.env',
  'require(',
  'import(',
  'fs.',
  'child_process',
  'eval(',
  'new Function(',
  'XMLHttpRequest',
  '__dirname',
  '__filename',
  'process.exit',
  'process.kill',
];
```

**Limitation:** The security scan is heuristic. It operates on the transpiled JavaScript string of the class constructor. Obfuscated code, computed property access (`process['env']`), or calls hidden in closures defined outside the class body may not be detected. This is documented and accepted; Worker thread isolation (see below) is the long-term answer.

### Layer 2 — Permission-gated context (`SdkContextProviderService`)

Every call to `buildSdkStrategyContext()` produces a `SdkStrategyContext` where each sub-interface is either:

- **Provided** — a real read-only implementation, if the strategy declared the corresponding permission
- **`null`** — the field is literally `null` if the permission is missing

Any method call on a `null` field throws `PermissionDeniedError` immediately without entering strategy code. This is enforced by the `permissionDeniedProxy<T>()` factory, which wraps a Proxy object whose `get` trap throws on every property access.

```typescript
// Example: strategy without READ_MARKET_DATA receives a null marketData
ctx.marketData?.lastPrice()   // returns undefined (optional chaining)
ctx.marketData!.lastPrice()   // throws PermissionDeniedError at runtime
```

### Layer 3 — Sandbox (`PluginSandbox`)

Every `generateSignal()`, `onOrderFilled()`, `onOrderRejected()`, and `onPositionUpdate()` call is dispatched through `PluginSandbox`, which enforces:

- **Timeout** — if the call does not resolve within `maxRuntimeMs`, the sandbox resolves with `null`
- **Rate limiting** — if more than `maxEventsPerSecond` calls are in flight, excess calls return `null` immediately without entering strategy code
- **Error containment** — any unhandled exception is caught, logged, and surfaced as a `null` result; it never propagates to the core engine

---

## Static Security Scan

The scan is performed synchronously during `PluginValidationService.validate()`. A strategy fails the security phase if any blocked pattern appears in the serialised source:

```typescript
const source = strategy.constructor.toString();
for (const pattern of BLOCKED_API_PATTERNS) {
  if (source.includes(pattern)) {
    issues.push({ phase: 'security-scan', field: 'source', message: `Blocked API: ${pattern}` });
  }
}
```

If any issues are found, `valid` is set to `false` and installation is rejected. The exact patterns are logged at `WARN` level.

### Known limitations

| Bypass vector | Risk level | Mitigation |
|---|---|---|
| `process['env']` — computed property | Medium | Worker thread will block by default |
| Code split across module boundaries | Medium | Full-source scan (future) |
| Dynamically imported helper | High | Dependency allowlist + Worker isolation |
| Native add-on (`.node`) | Critical | Not possible in same-process mode; blocked in Worker mode |

---

## Permission System

Permissions are declared in `manifest.permissions` and enforced at context-construction time. They are stored as a `ReadonlySet<StrategyPermission>` inside `SdkStrategyAdapter` and passed to `buildSdkStrategyContext()` on every tick.

```typescript
export enum StrategyPermission {
  GENERATE_SIGNALS      = 'GENERATE_SIGNALS',
  READ_MARKET_DATA      = 'READ_MARKET_DATA',
  READ_INDICATORS       = 'READ_INDICATORS',
  READ_PORTFOLIO        = 'READ_PORTFOLIO',
  READ_RISK_STATE       = 'READ_RISK_STATE',
  READ_EXECUTION_REPORTS = 'READ_EXECUTION_REPORTS',
  ACCESS_HISTORICAL_DATA = 'ACCESS_HISTORICAL_DATA',
}
```

### Enforcement

| Sub-interface | Permission required | Effect when missing |
|---|---|---|
| `ctx.marketData` | `READ_MARKET_DATA` | Field is `null` |
| `ctx.indicators` | `READ_INDICATORS` | Field is `null` |
| `ctx.portfolio` | `READ_PORTFOLIO` | Field is `null` |
| `ctx.riskState` | `READ_RISK_STATE` | Field is `null` |
| `ctx.executionReports` | `READ_EXECUTION_REPORTS` | Field is `null` |
| `ctx.historical` | `ACCESS_HISTORICAL_DATA` | Not provided in `onWarmup()` |

`GENERATE_SIGNALS` is mandatory. A manifest without it is rejected during manifest validation before the strategy is ever instantiated.

---

## Resource Limits

Resource limits can be declared in two places:

1. **`manifest.riskLimits`** — set by the strategy author
2. **`config.resourceLimits`** — set by the platform operator

The sandbox uses the **more restrictive** value from each category:

```typescript
const sandboxConfig: SandboxConfig = {
  maxRuntimeMs:       Math.min(manifest.riskLimits?.maxRuntimeMs       ?? Infinity, config.resourceLimits.maxRuntimeMs),
  maxEventsPerSecond: Math.min(manifest.riskLimits?.maxEventsPerSecond ?? Infinity, config.resourceLimits.maxEventsPerSecond),
};
```

This ensures that even if a strategy author sets generous self-limits, the operator can always cap them below platform thresholds.

---

## What Strategies Cannot Do

Under the current same-process model, strategies technically execute in the same Node.js process as the platform. The security model relies on:

1. The strategy not deliberately circumventing the static scan
2. The permission system catching runtime violations
3. The sandbox absorbing runaway calls

The following are explicitly out of scope for this release and will require Worker thread isolation to enforce:

- Preventing `process.env` access via computed properties
- Hard memory limits (Node.js `--max-old-space-size` applies process-wide)
- Preventing `setTimeout`/`setInterval` usage to schedule background work
- Module-level side effects on `require`

---

## Trusted vs. Untrusted Strategies

| Classification | Example | Protection level |
|---|---|---|
| **Trusted** | First-party strategies; audited third-party | Current model sufficient |
| **Trusted-but-fallible** | External developers following SDK guide | Current model sufficient |
| **Untrusted / adversarial** | Arbitrary user-submitted code | Requires Worker isolation |

The current model targets the first two categories. Untrusted strategy execution requires the Worker thread upgrade described below.

---

## Future: Worker Thread Isolation

The long-term security upgrade is to execute each strategy inside a dedicated `worker_threads.Worker` with a restricted module resolution context. This provides:

| Property | Benefit |
|---|---|
| Separate V8 heap | Hard memory cap via `resourceLimits.maxOldGenerationSizeMb` |
| No shared globals | `process.env`, `global`, `require` are not accessible |
| Termination | `worker.terminate()` kills a runaway strategy without affecting the core |
| Message-channel communication | Context and signals travel as structured-clone messages; no shared references |

### Migration path

The adapter interface is designed so that Worker thread execution is a drop-in replacement:

```
Current:   SdkStrategyAdapter → PluginSandbox → strategy.generateSignal()
Worker:    SdkStrategyAdapter → WorkerSandbox → postMessage(ctx) → worker receives → generates signal → postMessage(signal)
```

The `SdkStrategyContext` interfaces already use value semantics (no functions, no class instances with prototype methods would survive structured-clone). The `SdkSignal` return type is a plain object.

**Estimated timeline:** Worker thread isolation is planned for SDK `2.0.0` once the same-process model has been validated in production.

---

## Incident Response

If a strategy is found to be behaving maliciously or unexpectedly:

1. **Immediate**: Call `pluginLifecycleManager.uninstall(strategyId)` — this disables the adapter, unregisters it from the strategy registry, and removes it from the in-memory map. The strategy receives no further ticks.
2. **Investigation**: Retrieve the `PluginEntry.lastError` and platform logs tagged with `strategy:{strategyId}`.
3. **Audit**: Cross-reference `manifest.permissions` against observed behavior.
4. **Disclosure**: If a sandbox bypass is discovered, the security scan patterns (`BLOCKED_API_PATTERNS`) should be updated and a PATCH release issued.

### Logging

All sandbox errors are logged at `ERROR` level:

```
[strategy:my-strategy-v1] Sandbox error in generateSignal: <message>
```

Strategy `this.log()` messages are logged at `DEBUG` level:

```
[strategy:my-strategy-v1] <user message>
```

These can be correlated by `strategyId` in any structured log aggregator (e.g. Loki, CloudWatch Logs Insights).
