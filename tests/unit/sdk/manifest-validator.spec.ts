import {
  validateManifest,
  assertValidManifest,
  StrategyPermission,
  PluginManifest,
} from '@trading-platform/strategy-sdk';

// ── Helpers ────────────────────────────────────────────────────────────────────

function validManifest(overrides: Partial<PluginManifest> = {}): unknown {
  return {
    id: 'test-strategy-v1',
    name: 'Test Strategy',
    version: '1.0.0',
    author: { name: 'Test Author', email: 'test@example.com' },
    license: 'MIT',
    description: 'A test strategy for unit tests.',
    requiredSdkVersion: '^1.0.0',
    permissions: [StrategyPermission.READ_INDICATORS, StrategyPermission.GENERATE_SIGNALS],
    ...overrides,
  } as unknown;
}

// ── validateManifest ──────────────────────────────────────────────────────────

describe('validateManifest', () => {
  it('accepts a valid minimal manifest', () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('root');
  });

  it('rejects non-object', () => {
    const result = validateManifest('not-an-object');
    expect(result.valid).toBe(false);
  });

  // ── id ──────────────────────────────────────────────────────────────────────

  it('rejects missing id', () => {
    const result = validateManifest(validManifest({ id: '' as unknown as string }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('rejects id with uppercase letters', () => {
    const result = validateManifest(validManifest({ id: 'MyStrategy' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('accepts lowercase hyphenated id', () => {
    const result = validateManifest(validManifest({ id: 'sma-crossover-v1' }));
    expect(result.valid).toBe(true);
  });

  it('rejects id longer than 64 chars', () => {
    const result = validateManifest(validManifest({ id: 'a'.repeat(65) }));
    expect(result.valid).toBe(false);
  });

  // ── version ─────────────────────────────────────────────────────────────────

  it('rejects invalid semver', () => {
    const result = validateManifest(validManifest({ version: '1.0' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'version')).toBe(true);
  });

  it('accepts valid semver', () => {
    const result = validateManifest(validManifest({ version: '2.3.1' }));
    expect(result.valid).toBe(true);
  });

  // ── permissions ─────────────────────────────────────────────────────────────

  it('rejects manifest without GENERATE_SIGNALS', () => {
    const result = validateManifest(
      validManifest({
        permissions: [StrategyPermission.READ_INDICATORS],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'permissions')).toBe(true);
  });

  it('rejects unknown permission string', () => {
    const result = validateManifest(
      validManifest({
        permissions: [
          StrategyPermission.GENERATE_SIGNALS,
          'HACK_SYSTEM' as unknown as StrategyPermission,
        ],
      }),
    );
    expect(result.valid).toBe(false);
  });

  // ── requiredSdkVersion ───────────────────────────────────────────────────────

  it('rejects incompatible SDK version', () => {
    const result = validateManifest(validManifest({ requiredSdkVersion: '^99.0.0' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'requiredSdkVersion')).toBe(true);
  });

  it('rejects wildcard SDK version', () => {
    const result = validateManifest(validManifest({ requiredSdkVersion: '*' }));
    expect(result.valid).toBe(false);
  });

  // ── dependencies ────────────────────────────────────────────────────────────

  it('accepts allowed dependency', () => {
    const result = validateManifest(
      validManifest({
        dependencies: [{ name: 'decimal.js', version: '10.4.3' }],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects dependency not on allowlist', () => {
    const result = validateManifest(
      validManifest({
        dependencies: [{ name: 'axios', version: '1.0.0' }],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects dependency with non-exact version (caret)', () => {
    const result = validateManifest(
      validManifest({
        dependencies: [{ name: 'lodash', version: '^4.17.21' }],
      }),
    );
    expect(result.valid).toBe(false);
  });

  // ── riskLimits ───────────────────────────────────────────────────────────────

  it('accepts valid riskLimits', () => {
    const result = validateManifest(
      validManifest({
        riskLimits: {
          maxPositionSizePercent: 2,
          maxDrawdownPercent: 10,
          maxOpenOrders: 1,
          maxRuntimeMs: 500,
          maxEventsPerSecond: 100,
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects negative maxRuntimeMs', () => {
    const result = validateManifest(
      validManifest({
        riskLimits: { maxRuntimeMs: -1 },
      }),
    );
    expect(result.valid).toBe(false);
  });

  // ── homepage ─────────────────────────────────────────────────────────────────

  it('rejects http homepage', () => {
    const result = validateManifest(
      validManifest({
        homepage: 'http://example.com',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'homepage')).toBe(true);
  });

  it('accepts https homepage', () => {
    const result = validateManifest(
      validManifest({
        homepage: 'https://example.com',
      }),
    );
    expect(result.valid).toBe(true);
  });
});

// ── assertValidManifest ───────────────────────────────────────────────────────

describe('assertValidManifest', () => {
  it('does not throw for a valid manifest', () => {
    expect(() => assertValidManifest(validManifest())).not.toThrow();
  });

  it('throws for an invalid manifest', () => {
    expect(() => assertValidManifest({ id: 'bad!id' })).toThrow();
  });

  it('provides error detail in the thrown message', () => {
    expect(() => assertValidManifest(null)).toThrowError(/manifest/i);
  });
});
