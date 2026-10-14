import { getRandomValues } from "node:crypto";
import { isUuidV7 } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";

const MAX_UNIX_MS = 2 ** 48 - 1;
const RANDOM_BITS = 74n;
const RANDOM_MAX = (1n << RANDOM_BITS) - 1n;

export function encodeUuidV7(nowMs: number, random: bigint): UuidV7 {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > MAX_UNIX_MS) {
    throw new RangeError("UUIDv7 timestamp must be an integer number of milliseconds within 48 bits");
  }
  if (random < 0n || random > RANDOM_MAX) {
    throw new RangeError("UUIDv7 random field must fit in 74 bits");
  }
  const randA = (random >> 62n) & 0xfffn;
  const randB = random & ((1n << 62n) - 1n);
  const value = (BigInt(nowMs) << 80n) | (0x7n << 76n) | (randA << 64n) | (0b10n << 62n) | randB;
  const hex = value.toString(16).padStart(32, "0");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!isUuidV7(id)) throw new Error("encoded id is not a canonical UUIDv7");
  return id;
}

let lastMs = -1;
let lastRandom = 0n;

function freshRandom(): bigint {
  const bytes = getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value & RANDOM_MAX;
}

export function mintUuidV7(): UuidV7 {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    lastRandom = freshRandom();
  } else if (lastRandom < RANDOM_MAX) {
    lastRandom += 1n;
  } else {
    lastMs += 1;
    lastRandom = freshRandom();
  }
  return encodeUuidV7(lastMs, lastRandom);
}
