import { VersionCompatibilityChecker } from '@trading-platform/strategy-sdk';

describe('VersionCompatibilityChecker', () => {
  // SDK_API_VERSION is '1.0.0'

  // ── isCompatible ────────────────────────────────────────────────────────────

  describe('isCompatible', () => {
    // Exact match
    it('accepts exact version match', () => {
      expect(VersionCompatibilityChecker.isCompatible('1.0.0')).toBe(true);
    });

    it('rejects exact version mismatch', () => {
      expect(VersionCompatibilityChecker.isCompatible('2.0.0')).toBe(false);
    });

    // Caret ranges
    it('accepts caret range that matches (same major)', () => {
      expect(VersionCompatibilityChecker.isCompatible('^1.0.0')).toBe(true);
    });

    it('accepts caret range with lower patch', () => {
      // '^1.0.0' accepts 1.0.0 and above within major 1
      expect(VersionCompatibilityChecker.isCompatible('^1.0.0')).toBe(true);
    });

    it('rejects caret range with different major', () => {
      expect(VersionCompatibilityChecker.isCompatible('^2.0.0')).toBe(false);
    });

    // Tilde ranges
    it('accepts tilde range (same major.minor)', () => {
      expect(VersionCompatibilityChecker.isCompatible('~1.0.0')).toBe(true);
    });

    it('rejects tilde range for different minor', () => {
      expect(VersionCompatibilityChecker.isCompatible('~1.1.0')).toBe(false);
    });

    it('rejects tilde range for different major', () => {
      expect(VersionCompatibilityChecker.isCompatible('~2.0.0')).toBe(false);
    });

    // GTE ranges
    it('accepts >= range that SDK version satisfies', () => {
      expect(VersionCompatibilityChecker.isCompatible('>=1.0.0')).toBe(true);
    });

    it('rejects >= range that SDK version does not satisfy', () => {
      expect(VersionCompatibilityChecker.isCompatible('>=2.0.0')).toBe(false);
    });

    // Compound range
    it('accepts compound range (>=X <Y) satisfied', () => {
      expect(VersionCompatibilityChecker.isCompatible('>=1.0.0 <2.0.0')).toBe(true);
    });

    it('rejects compound range (>=X <Y) not satisfied', () => {
      expect(VersionCompatibilityChecker.isCompatible('>=2.0.0 <3.0.0')).toBe(false);
    });

    // Wildcards — rejected
    it('rejects wildcard *', () => {
      expect(VersionCompatibilityChecker.isCompatible('*')).toBe(false);
    });

    it('rejects wildcard x', () => {
      expect(VersionCompatibilityChecker.isCompatible('x')).toBe(false);
    });

    // Malformed
    it('rejects unrecognised format', () => {
      expect(VersionCompatibilityChecker.isCompatible('not-a-version')).toBe(false);
    });
  });

  // ── incompatibilityReason ──────────────────────────────────────────────────

  describe('incompatibilityReason', () => {
    it('returns null for compatible version', () => {
      expect(VersionCompatibilityChecker.incompatibilityReason('^1.0.0')).toBeNull();
    });

    it('returns a reason string for incompatible version', () => {
      const reason = VersionCompatibilityChecker.incompatibilityReason('^2.0.0');
      expect(reason).toBeTruthy();
      expect(typeof reason).toBe('string');
    });

    it('returns a reason for wildcard', () => {
      const reason = VersionCompatibilityChecker.incompatibilityReason('*');
      expect(reason).toBeTruthy();
    });

    it('returns a reason for unrecognised format', () => {
      const reason = VersionCompatibilityChecker.incompatibilityReason('invalid');
      expect(reason).toBeTruthy();
    });
  });

  // ── compareVersions ────────────────────────────────────────────────────────

  describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
      expect(VersionCompatibilityChecker.compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('returns positive when a > b (major)', () => {
      expect(VersionCompatibilityChecker.compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    });

    it('returns negative when a < b (minor)', () => {
      expect(VersionCompatibilityChecker.compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    });

    it('returns positive when a > b (patch)', () => {
      expect(VersionCompatibilityChecker.compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });
  });
});
