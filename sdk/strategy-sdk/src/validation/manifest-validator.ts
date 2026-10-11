import { PluginManifest } from '../plugin/manifest';
import { StrategyPermission } from '../plugin/permissions';
import { VersionCompatibilityChecker } from './version-compatibility';

export interface ManifestValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ManifestValidationError[];
}

/**
 * APPROVED_DEPENDENCY_ALLOWLIST is the set of npm package names a strategy may declare.
 *
 * This allowlist is intentionally minimal and conservative. Each entry has been
 * reviewed for security, stability, and absence of transitive side effects.
 * Requests to add packages require a platform maintainer review.
 *
 * Strategies should prefer pure computation using only built-in JavaScript features.
 * Dependencies increase supply-chain risk and build complexity.
 */
const APPROVED_DEPENDENCY_ALLOWLIST = new Set([
  'decimal.js',
  'bignumber.js',
  'mathjs',
  'simple-statistics',
  'lodash',
]);

/**
 * validateManifest performs static structural validation of a PluginManifest.
 *
 * This is the first gate in the plugin install pipeline. It checks:
 *
 *   1. Required fields are present and correctly typed
 *   2. id follows the naming convention (lowercase, hyphen-separated)
 *   3. version is valid semver
 *   4. requiredSdkVersion is a recognized range pattern and is compatible
 *   5. GENERATE_SIGNALS permission is declared
 *   6. All declared permissions are recognized StrategyPermission values
 *   7. Dependencies are pinned to exact versions and on the allowlist
 *   8. riskLimits fields are within acceptable ranges
 *   9. keywords and description length limits
 *   10. homepage uses HTTPS
 *
 * This function does NOT:
 *   - Load or execute the plugin code
 *   - Perform AST analysis (that is a separate security-scan step)
 *   - Check live platform state (no I/O, no async)
 *
 * All checks are synchronous and pure — safe to run in any context.
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  if (typeof manifest !== 'object' || manifest === null) {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'Manifest must be a non-null object.' }],
    };
  }

  const m = manifest as Record<string, unknown>;

  // ── 1. id ──────────────────────────────────────────────────────────────────
  if (typeof m['id'] !== 'string' || m['id'].length === 0) {
    errors.push({ field: 'id', message: 'id is required and must be a non-empty string.' });
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m['id'] as string)) {
    errors.push({
      field: 'id',
      message: 'id must be lowercase and hyphen-separated (e.g. "sma-crossover-v1").',
    });
  } else if ((m['id'] as string).length > 64) {
    errors.push({ field: 'id', message: 'id must be 64 characters or fewer.' });
  }

  // ── 2. name ────────────────────────────────────────────────────────────────
  if (typeof m['name'] !== 'string' || m['name'].length === 0) {
    errors.push({ field: 'name', message: 'name is required.' });
  } else if ((m['name'] as string).length > 100) {
    errors.push({ field: 'name', message: 'name must be 100 characters or fewer.' });
  }

  // ── 3. version ─────────────────────────────────────────────────────────────
  if (typeof m['version'] !== 'string') {
    errors.push({ field: 'version', message: 'version is required.' });
  } else if (!/^\d+\.\d+\.\d+$/.test(m['version'] as string)) {
    errors.push({ field: 'version', message: 'version must be a valid semver (e.g. "1.0.0").' });
  }

  // ── 4. author ──────────────────────────────────────────────────────────────
  if (typeof m['author'] !== 'object' || m['author'] === null) {
    errors.push({ field: 'author', message: 'author is required and must be an object.' });
  } else {
    const author = m['author'] as Record<string, unknown>;
    if (typeof author['name'] !== 'string' || (author['name'] as string).length === 0) {
      errors.push({ field: 'author.name', message: 'author.name is required.' });
    }
    if (author['email'] !== undefined && typeof author['email'] !== 'string') {
      errors.push({ field: 'author.email', message: 'author.email must be a string.' });
    }
    if (author['url'] !== undefined && typeof author['url'] !== 'string') {
      errors.push({ field: 'author.url', message: 'author.url must be a string.' });
    }
  }

  // ── 5. license ─────────────────────────────────────────────────────────────
  if (typeof m['license'] !== 'string' || m['license'].length === 0) {
    errors.push({ field: 'license', message: 'license is required (e.g. "MIT", "UNLICENSED").' });
  }

  // ── 6. description ─────────────────────────────────────────────────────────
  if (typeof m['description'] !== 'string' || m['description'].length === 0) {
    errors.push({ field: 'description', message: 'description is required.' });
  } else if ((m['description'] as string).length > 500) {
    errors.push({ field: 'description', message: 'description must be 500 characters or fewer.' });
  }

  // ── 7. requiredSdkVersion ──────────────────────────────────────────────────
  if (typeof m['requiredSdkVersion'] !== 'string' || m['requiredSdkVersion'].length === 0) {
    errors.push({ field: 'requiredSdkVersion', message: 'requiredSdkVersion is required.' });
  } else {
    const reason = VersionCompatibilityChecker.incompatibilityReason(m['requiredSdkVersion'] as string);
    if (reason) {
      errors.push({ field: 'requiredSdkVersion', message: reason });
    }
  }

  // ── 8. permissions ─────────────────────────────────────────────────────────
  const knownPermissions = new Set<string>(Object.values(StrategyPermission));
  if (!Array.isArray(m['permissions'])) {
    errors.push({ field: 'permissions', message: 'permissions must be an array.' });
  } else {
    const permissions = m['permissions'] as unknown[];
    if (!permissions.includes(StrategyPermission.GENERATE_SIGNALS)) {
      errors.push({
        field: 'permissions',
        message: `GENERATE_SIGNALS permission is required. Without it, the strategy never emits signals.`,
      });
    }
    for (const perm of permissions) {
      if (typeof perm !== 'string') {
        errors.push({ field: 'permissions', message: 'Each permission must be a string.' });
      } else if (!knownPermissions.has(perm)) {
        errors.push({
          field: 'permissions',
          message: `Unknown permission "${perm}". Valid values: ${[...knownPermissions].join(', ')}`,
        });
      }
    }
  }

  // ── 9. dependencies ────────────────────────────────────────────────────────
  if (m['dependencies'] !== undefined) {
    if (!Array.isArray(m['dependencies'])) {
      errors.push({ field: 'dependencies', message: 'dependencies must be an array if provided.' });
    } else {
      const deps = m['dependencies'] as unknown[];
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        if (typeof dep !== 'object' || dep === null) {
          errors.push({ field: `dependencies[${i}]`, message: 'Each dependency must be an object.' });
          continue;
        }
        const d = dep as Record<string, unknown>;
        if (typeof d['name'] !== 'string' || (d['name'] as string).length === 0) {
          errors.push({ field: `dependencies[${i}].name`, message: 'Dependency name is required.' });
        } else if (!APPROVED_DEPENDENCY_ALLOWLIST.has(d['name'] as string)) {
          errors.push({
            field: `dependencies[${i}].name`,
            message: `"${d['name']}" is not on the approved dependency allowlist.`,
          });
        }
        if (typeof d['version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(d['version'] as string)) {
          errors.push({
            field: `dependencies[${i}].version`,
            message: 'Dependency version must be an exact semver (e.g. "4.17.21").',
          });
        }
      }
    }
  }

  // ── 10. riskLimits ────────────────────────────────────────────────────────
  if (m['riskLimits'] !== undefined) {
    if (typeof m['riskLimits'] !== 'object' || m['riskLimits'] === null) {
      errors.push({ field: 'riskLimits', message: 'riskLimits must be an object if provided.' });
    } else {
      const rl = m['riskLimits'] as Record<string, unknown>;
      const positive = (key: string) => {
        if (rl[key] !== undefined && (typeof rl[key] !== 'number' || (rl[key] as number) <= 0)) {
          errors.push({ field: `riskLimits.${key}`, message: `${key} must be a positive number.` });
        }
      };
      positive('maxPositionSizePercent');
      positive('maxDrawdownPercent');
      positive('maxOpenOrders');
      positive('maxRuntimeMs');
      positive('maxEventsPerSecond');
    }
  }

  // ── 11. keywords ──────────────────────────────────────────────────────────
  if (m['keywords'] !== undefined) {
    if (!Array.isArray(m['keywords'])) {
      errors.push({ field: 'keywords', message: 'keywords must be an array if provided.' });
    } else {
      if ((m['keywords'] as unknown[]).length > 20) {
        errors.push({ field: 'keywords', message: 'keywords must have at most 20 entries.' });
      }
      for (const kw of m['keywords'] as unknown[]) {
        if (typeof kw !== 'string' || (kw as string).length > 50) {
          errors.push({ field: 'keywords', message: 'Each keyword must be a string of at most 50 chars.' });
        }
      }
    }
  }

  // ── 12. homepage ──────────────────────────────────────────────────────────
  if (m['homepage'] !== undefined) {
    if (typeof m['homepage'] !== 'string') {
      errors.push({ field: 'homepage', message: 'homepage must be a string.' });
    } else if (!(m['homepage'] as string).startsWith('https://')) {
      errors.push({ field: 'homepage', message: 'homepage must use HTTPS.' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * assertValidManifest throws if the manifest fails validation.
 * Provides a convenient alternative to the result-returning validateManifest().
 */
export function assertValidManifest(manifest: unknown): asserts manifest is PluginManifest {
  const result = validateManifest(manifest);
  if (!result.valid) {
    const summary = result.errors.map((e) => `  ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Plugin manifest validation failed:\n${summary}`);
  }
}
