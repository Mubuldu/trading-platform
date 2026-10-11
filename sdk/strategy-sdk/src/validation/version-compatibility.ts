import { SDK_API_VERSION } from '../version/sdk-version';

/**
 * VersionCompatibilityChecker validates whether a plugin's requiredSdkVersion
 * semver range is compatible with the current SDK_API_VERSION.
 *
 * ## Semver compatibility rules
 *
 * The platform uses a strict subset of semver ranges for safety:
 *
 *   "^1.0.0"           → accepts 1.x.x (any MINOR or PATCH within MAJOR 1)
 *   ">=1.0.0 <2.0.0"   → explicit range; equivalent to ^1.0.0
 *   "~1.0.0"           → accepts 1.0.x (PATCH only)
 *   "1.0.0"            → exact version only (NOT recommended; breaks on patches)
 *   "*"                → rejected; too broad to guarantee API compatibility
 *
 * The checker does NOT use a full semver library (no external dependencies in SDK).
 * It implements the subset of range expressions actually used in plugin manifests.
 * Exotic ranges (pre-release, build metadata, ||) are rejected as unsupported.
 *
 * ## Why not allow any range?
 *
 * Allowing ">0.0.0" or "*" would permit plugins to run against SDK major versions
 * they were never tested against. A major version bump signals breaking API changes.
 * Strict range validation prevents silent incompatibilities at runtime.
 */
export class VersionCompatibilityChecker {
  private static readonly CURRENT = SDK_API_VERSION;

  /**
   * Returns true when the plugin's requiredSdkVersion range is satisfied
   * by the current SDK_API_VERSION.
   *
   * Returns false for:
   *   - Malformed version strings
   *   - Unsupported range operators
   *   - Ranges that exclude the current SDK version
   *   - Wildcards ("*" or "x")
   */
  static isCompatible(requiredRange: string): boolean {
    const range = requiredRange.trim();

    // Wildcard — rejected
    if (range === '*' || range === 'x') return false;

    // Exact version — "1.0.0"
    if (/^\d+\.\d+\.\d+$/.test(range)) {
      return range === this.CURRENT;
    }

    // Caret — "^1.0.0" → >=1.0.0 <2.0.0
    const caretMatch = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
    if (caretMatch) {
      const [, rMajor, rMinor, rPatch] = caretMatch.map(Number);
      const [cMajor, cMinor, cPatch] = this.CURRENT.split('.').map(Number);
      if (cMajor !== rMajor) return false;
      return (
        cMinor > rMinor ||
        (cMinor === rMinor && cPatch >= rPatch)
      );
    }

    // Tilde — "~1.0.0" → >=1.0.0 <1.1.0
    const tildeMatch = range.match(/^~(\d+)\.(\d+)\.(\d+)$/);
    if (tildeMatch) {
      const [, rMajor, rMinor, rPatch] = tildeMatch.map(Number);
      const [cMajor, cMinor, cPatch] = this.CURRENT.split('.').map(Number);
      if (cMajor !== rMajor || cMinor !== rMinor) return false;
      return cPatch >= rPatch;
    }

    // Range pair — ">=1.0.0 <2.0.0"
    const rangeMatch = range.match(/^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/);
    if (rangeMatch) {
      const [, lower, upper] = rangeMatch;
      return (
        this.compareVersions(this.CURRENT, lower) >= 0 &&
        this.compareVersions(this.CURRENT, upper) < 0
      );
    }

    // Greater-or-equal without upper bound — ">= 1.0.0"
    const gteMatch = range.match(/^>=(\d+\.\d+\.\d+)$/);
    if (gteMatch) {
      return this.compareVersions(this.CURRENT, gteMatch[1]) >= 0;
    }

    // Unrecognised format — reject conservatively
    return false;
  }

  /**
   * Returns a human-readable reason why a range is incompatible, or null if compatible.
   */
  static incompatibilityReason(requiredRange: string): string | null {
    if (this.isCompatible(requiredRange)) return null;

    const range = requiredRange.trim();
    if (range === '*' || range === 'x') {
      return `Wildcard range "${range}" is not permitted — declare a specific range like "^${this.CURRENT}".`;
    }
    return (
      `requiredSdkVersion "${requiredRange}" is incompatible with the current ` +
      `SDK version "${this.CURRENT}". Update the plugin or the platform to resolve.`
    );
  }

  /**
   * Compares two semver strings lexicographically by numeric components.
   * Returns: negative if a < b, 0 if a === b, positive if a > b.
   */
  static compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}
