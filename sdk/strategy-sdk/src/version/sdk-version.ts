/**
 * SDK_API_VERSION is the semantic version of the Strategy SDK public API.
 *
 * Plugin manifests declare `requiredSdkVersion` using a semver range expression
 * (e.g. "^1.0.0"). The platform reads this version at plugin install time and
 * rejects any plugin whose declared range is incompatible.
 *
 * Version policy:
 *   PATCH — bug fixes in SDK utilities, doc corrections, no API surface changes
 *   MINOR — new optional hooks, new read-only API additions, new enum values
 *           — backward compatible: existing plugins compile and run unchanged
 *   MAJOR — breaking interface changes (hook signatures, removed APIs, enum renames)
 *           — requires coordinated migration of all installed plugins
 *
 * Authors MUST pin a range that allows all compatible MINOR and PATCH versions:
 *   Correct  : "^1.0.0" (accepts 1.x.x, rejects 2.x.x)
 *   Correct  : ">=1.0.0 <2.0.0" (explicit equivalent)
 *   Incorrect: "1.0.0"  (exact pin — breaks on every patch release)
 *   Incorrect: "*"       (rejected; too broad to guarantee API compatibility)
 */
export const SDK_API_VERSION = '1.0.0' as const;

export type SdkApiVersion = typeof SDK_API_VERSION;
