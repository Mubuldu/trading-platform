/**
 * SdkResult<T, E> is a lightweight discriminated union for SDK operations
 * that can fail in a typed way.
 *
 * The SDK does not import the platform's Result<T,E> type — this keeps the SDK
 * self-contained and usable without any platform dependency.
 *
 * Use sdkOk() and sdkErr() factory functions rather than constructing objects directly.
 *
 * Example:
 *   const result = validateMyConfig(params);
 *   if (!result.success) {
 *     console.error(result.error.message);
 *     return;
 *   }
 *   // result.value is typed and available here
 */
export type SdkResult<T, E extends Error = Error> =
  | { readonly success: true;  readonly value: T }
  | { readonly success: false; readonly error: E };

export function sdkOk<T>(value: T): SdkResult<T, never> {
  return { success: true, value };
}

export function sdkErr<E extends Error>(error: E): SdkResult<never, E> {
  return { success: false, error };
}

/**
 * SdkConfigValidationError is thrown (or returned via SdkResult) when a strategy's
 * configuration does not satisfy the strategy's own validation rules.
 *
 * The platform catches this during install and reports it as a validation failure —
 * the plugin is not loaded.
 */
export class SdkConfigValidationError extends Error {
  constructor(
    public readonly strategyId: string,
    public readonly reason: string,
  ) {
    super(`Strategy "${strategyId}" config validation failed: ${reason}`);
    this.name = 'SdkConfigValidationError';
  }
}

/**
 * PermissionDeniedError is thrown when a strategy attempts to access a platform API
 * it did not declare in its manifest's permissions list.
 *
 * This is a programming error in the plugin, not a runtime failure — it should be
 * caught during integration testing before the plugin reaches production.
 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly strategyId: string,
    public readonly missingPermission: string,
  ) {
    super(
      `Strategy "${strategyId}" attempted to access "${missingPermission}" ` +
      `without declaring it in the manifest's permissions list.`,
    );
    this.name = 'PermissionDeniedError';
  }
}
