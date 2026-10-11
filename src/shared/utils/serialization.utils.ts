import { SerializationError } from '@common/errors/infrastructure.error';
import { Result, ok, err } from '@common/result';

/**
 * SerializationUtils — safe JSON serialization with structured error handling.
 *
 * Raw JSON.parse/stringify are dangerous at system boundaries:
 *  - JSON.parse throws on invalid input
 *  - JSON.stringify throws on circular references and BigInt values
 *
 * These helpers wrap the unsafe operations in a Result so callers always
 * handle the error path explicitly.
 *
 * The tryParse overload with a type guard enables type-safe deserialization
 * at external boundaries (API responses, message queue payloads).
 */
export const SerializationUtils = {
  tryStringify(value: unknown, indent?: number): Result<string, SerializationError> {
    try {
      return ok(JSON.stringify(value, null, indent));
    } catch (e) {
      return err(
        new SerializationError(
          `Serialization failed: ${e instanceof Error ? e.message : String(e)}`,
          undefined,
          e instanceof Error ? e : undefined,
        ),
      );
    }
  },

  tryParse<T>(json: string, guard?: (value: unknown) => value is T): Result<T, SerializationError> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return err(
        new SerializationError(
          `Deserialization failed: ${e instanceof Error ? e.message : String(e)}`,
          undefined,
          e instanceof Error ? e : undefined,
        ),
      );
    }

    if (guard !== undefined && !guard(parsed)) {
      return err(
        new SerializationError('Deserialized value failed type guard validation', {
          receivedType: typeof parsed,
        }),
      );
    }

    return ok(parsed as T);
  },

  /**
   * Deep-clones a value via JSON round-trip.
   * Only safe for plain JSON-serializable objects (no class instances, no Dates).
   */
  deepClone<T>(value: T): Result<T, SerializationError> {
    return SerializationUtils.tryStringify(value).flatMap((json) =>
      SerializationUtils.tryParse<T>(json),
    );
  },

  /**
   * Omits specified keys from an object, returning a new object.
   * Useful for sanitizing sensitive fields before logging.
   */
  omitKeys<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): Partial<T> {
    const result = { ...obj };
    for (const key of keys) {
      delete result[key];
    }
    return result;
  },

  /**
   * Recursively redacts specified keys with a placeholder.
   * Use for masking API keys, tokens, and secrets before logging.
   */
  redactKeys(obj: unknown, keys: string[], placeholder = '[REDACTED]'): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj))
      return obj.map((item) => SerializationUtils.redactKeys(item, keys, placeholder));

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = keys.includes(k)
        ? placeholder
        : SerializationUtils.redactKeys(v, keys, placeholder);
    }
    return result;
  },
} as const;
