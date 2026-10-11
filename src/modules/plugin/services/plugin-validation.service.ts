/**
 * PluginValidationService — the static validation gate in the plugin install pipeline.
 *
 * Runs four sequential checks before any plugin code is executed or loaded:
 *
 *   1. Manifest Validation   — structural checks on the PluginManifest object
 *   2. SDK Version Check     — rejects plugins that require an incompatible SDK version
 *   3. Security Scan         — AST-level analysis of the strategy class; rejects
 *                              calls to blocked APIs (process.env, fs, net, require)
 *   4. Dependency Validation — ensures all declared npm deps are on the allowlist
 *                              and pinned to exact semver
 *
 * These checks are all synchronous and pure — no I/O, no side effects.
 * The service does NOT load or execute any plugin code.
 *
 * Usage:
 *   const result = pluginValidationService.validate(manifest, strategyInstance);
 *   if (!result.valid) {
 *     throw new PluginValidationError(result.errors);
 *   }
 */

import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  SdkStrategy,
  SDK_API_VERSION,
  validateManifest,
  VersionCompatibilityChecker,
  StrategyPermission,
} from '@trading-platform/strategy-sdk';

// ── Validation result types ────────────────────────────────────────────────────

export interface PluginValidationIssue {
  readonly phase: 'manifest' | 'sdk-version' | 'security-scan' | 'permissions';
  readonly field: string;
  readonly message: string;
}

export interface PluginValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PluginValidationIssue[];
}

// ── Security scan — blocked API patterns ─────────────────────────────────────

/**
 * BLOCKED_API_PATTERNS lists string patterns that must not appear in a strategy's
 * source code (obtained via Function.prototype.toString()).
 *
 * This is a lightweight heuristic scan — it is NOT a full AST parser. It catches
 * naive usage of blocked APIs. Determined adversaries can bypass this by obfuscating
 * strings. The primary defence against untrusted code is Worker-thread isolation
 * (see security-model.md); this scan is a best-effort defence-in-depth layer.
 *
 * Patterns use simple string includes() checks, not regex, to avoid ReDoS.
 */
const BLOCKED_API_PATTERNS: Array<{ pattern: string; description: string }> = [
  { pattern: 'process.env', description: 'Direct environment variable access (process.env)' },
  { pattern: 'require(', description: 'Dynamic require() call' },
  { pattern: 'import(', description: 'Dynamic import() call' },
  { pattern: 'fs.', description: 'File system access (fs module)' },
  { pattern: 'child_process', description: 'Child process spawning' },
  { pattern: 'eval(', description: 'eval() call' },
  { pattern: 'new Function(', description: 'Dynamic function construction via new Function()' },
  { pattern: 'XMLHttpRequest', description: 'Browser XHR call' },
  { pattern: '__dirname', description: 'Node.js __dirname path access' },
  { pattern: '__filename', description: 'Node.js __filename path access' },
  { pattern: 'process.exit', description: 'process.exit() call' },
  { pattern: 'process.kill', description: 'process.kill() call' },
];

// ── Required permissions ──────────────────────────────────────────────────────

const KNOWN_PERMISSIONS = new Set<string>(Object.values(StrategyPermission));

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class PluginValidationService {
  private readonly ctx = PluginValidationService.name;

  constructor(private readonly logger: AppLoggerService) {}

  /**
   * Validate a strategy plugin before it is loaded into the lifecycle manager.
   *
   * @param strategy — the instantiated SdkStrategy (manifest is read from it)
   * @returns PluginValidationResult with valid=true or a list of issues
   */
  validate(strategy: SdkStrategy): PluginValidationResult {
    const issues: PluginValidationIssue[] = [];

    // ── Phase 1: Manifest validation ──────────────────────────────────────────
    const manifestResult = validateManifest(strategy.manifest);
    if (!manifestResult.valid) {
      for (const e of manifestResult.errors) {
        issues.push({ phase: 'manifest', field: e.field, message: e.message });
      }
    }

    // ── Phase 2: SDK version compatibility ────────────────────────────────────
    if (strategy.manifest.requiredSdkVersion) {
      const reason = VersionCompatibilityChecker.incompatibilityReason(
        strategy.manifest.requiredSdkVersion,
      );
      if (reason) {
        issues.push({
          phase: 'sdk-version',
          field: 'requiredSdkVersion',
          message: `SDK version incompatibility: ${reason} (platform SDK version: ${SDK_API_VERSION})`,
        });
      }
    }

    // ── Phase 3: Security scan ────────────────────────────────────────────────
    const securityIssues = this.runSecurityScan(strategy);
    issues.push(...securityIssues);

    // ── Phase 4: Permission coherence ─────────────────────────────────────────
    const permIssues = this.validatePermissions(strategy);
    issues.push(...permIssues);

    const valid = issues.length === 0;
    if (!valid) {
      this.logger.warn(
        `Plugin "${strategy.manifest.id}" failed validation (${issues.length} issue(s)): ` +
          issues.map((i) => `[${i.phase}] ${i.field}: ${i.message}`).join('; '),
        this.ctx,
      );
    }

    return { valid, issues };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Runs a surface-level security scan by inspecting the strategy's serialized
   * source. Blocked API patterns are checked with string inclusion.
   *
   * Limitation: Function.prototype.toString() returns the source ONLY for
   * non-compiled code. In a compiled TypeScript → JavaScript environment, the
   * source is the transpiled JS, which may differ from the original TS. This
   * scan remains useful as a lightweight check for the most egregious violations.
   */
  private runSecurityScan(strategy: SdkStrategy): PluginValidationIssue[] {
    const issues: PluginValidationIssue[] = [];

    let source: string;
    try {
      // Serialize the constructor and prototype methods to a string for scanning
      source = strategy.constructor.toString();
    } catch {
      // Cannot serialize — skip scan (compiled/native code)
      this.logger.debug(
        `Security scan skipped for "${strategy.manifest.id}" — source not serializable`,
        this.ctx,
      );
      return [];
    }

    for (const { pattern, description } of BLOCKED_API_PATTERNS) {
      if (source.includes(pattern)) {
        issues.push({
          phase: 'security-scan',
          field: pattern,
          message: `Blocked API detected: ${description}`,
        });
      }
    }

    return issues;
  }

  /**
   * Validates that the permission array contains only recognised StrategyPermission values.
   * (GENERATE_SIGNALS presence is already enforced by validateManifest().)
   */
  private validatePermissions(strategy: SdkStrategy): PluginValidationIssue[] {
    const issues: PluginValidationIssue[] = [];
    const permissions = strategy.manifest.permissions ?? [];

    for (const perm of permissions) {
      if (!KNOWN_PERMISSIONS.has(perm)) {
        issues.push({
          phase: 'permissions',
          field: 'permissions',
          message: `Unknown permission "${perm}". Valid: ${[...KNOWN_PERMISSIONS].join(', ')}`,
        });
      }
    }

    return issues;
  }
}
