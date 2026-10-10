declare const uuidV7Brand: unique symbol;

/**
 * An opaque UUIDv7 id (RFC 9562), in canonical lowercase form.
 *
 * The registry mints these for tenants, Projects, Modules, Standards and
 * Applications; clients never generate them. Obtain one only through
 * {@link isUuidV7} or from the registry.
 */
export type UuidV7 = string & { readonly [uuidV7Brand]: "UuidV7" };

// 8-4-4-4-12 lowercase hex, version nibble 7, variant bits 10xx (8, 9, a or b).
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True when `value` is a canonical lowercase UUIDv7 string. Never throws. */
export function isUuidV7(value: unknown): value is UuidV7 {
  return typeof value === "string" && UUID_V7.test(value);
}
