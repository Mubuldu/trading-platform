/**
 * Strategy SDK — Public API barrel
 *
 * Re-exports every public symbol from the SDK sub-modules.
 * Do NOT define types here — all definitions live in the sub-module files.
 */

export * from './version/sdk-version';

// Market types
export * from './market/candle.types';
export * from './market/tick.types';
export * from './market/indicator.types';
export * from './market/position.types';
export * from './market/execution.types';
export * from './market/risk.types';
export * from './market/signal.types';

// Plugin metadata
export * from './plugin/permissions';
export * from './plugin/lifecycle';
export * from './plugin/manifest';

// Interfaces
export * from './interfaces/market-data.interface';
export * from './interfaces/indicators.interface';
export * from './interfaces/portfolio.interface';
export * from './interfaces/risk-state.interface';
export * from './interfaces/historical-data.interface';
export * from './interfaces/execution-reports.interface';

// Context
export * from './context/sdk-init-context';
export * from './context/sdk-strategy-context';

// Base classes and result helpers
export * from './base/sdk-result';
export * from './base/sdk-strategy';

// Validation utilities
export * from './validation/version-compatibility';
export * from './validation/manifest-validator';

// Sandbox
export * from './sandbox/plugin-sandbox';
