/**
 * A deterministic `.tar.gz` writer (Story 3.3): ustar entries for regular
 * files with mode 0644, uid/gid 0, mtime 0 and no owner names, in the order
 * given, then gzip. Equal inputs give identical bytes, so a Boilerplate is
 * reproducible and two targets can share files byte for byte.
 */
import { gunzipSync, gzipSync } from "node:zlib";

/** One file to pack. */
export interface ArchiveEntry {
  /** A relative path of at most 100 bytes, `/`-separated. */
  readonly path: string;
  readonly content: string;
}

const BLOCK = 512;

function writeString(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error("a tar header field is too long");
  bytes.copy(header, offset);
}

/** An octal number of `length - 1` digits, zero-padded, then NUL. */
function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const digits = value.toString(8).padStart(length - 1, "0");
  if (digits.length > length - 1) throw new Error("a tar header number is too large");
  writeString(header, offset, length, `${digits}\0`);
}

function header(path: string, size: number): Buffer {
  if (path === "" || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error("a tar path must be relative");
  }
  const block = Buffer.alloc(BLOCK);
  writeString(block, 0, 100, path); // name
  writeOctal(block, 100, 8, 0o644); // mode
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, size); // size
  writeOctal(block, 136, 12, 0); // mtime
  block.fill(0x20, 148, 156); // checksum placeholder: eight spaces
  writeString(block, 156, 1, "0"); // typeflag: regular file
  writeString(block, 257, 6, "ustar\0"); // magic
  writeString(block, 263, 2, "00"); // version
  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

/** The uncompressed ustar archive of `entries`, in order, ending with two zero blocks. */
export function tar(entries: readonly ArchiveEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.content, "utf8");
    parts.push(header(entry.path, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** The gzip-compressed ustar archive of `entries`: identical bytes for equal inputs. */
export function tarGz(entries: readonly ArchiveEntry[]): Buffer {
  return gzipSync(tar(entries), { level: 9 });
}

/** One entry read back by {@link untarGz}, with its header fields. */
export interface ReadEntry extends ArchiveEntry {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly mtime: number;
  readonly typeflag: string;
  readonly magic: string;
}

const field = (block: Buffer, offset: number, length: number): string =>
  block.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/s, "");

/**
 * Read back a `.tar.gz` written by {@link tarGz}: regular-file ustar entries
 * until the zero blocks. Verifies each header checksum; throws on anything it
 * does not understand. Used by tests and tooling to inspect a Boilerplate.
 */
export function untarGz(archive: Buffer): ReadEntry[] {
  const data = gunzipSync(archive);
  const entries: ReadEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= data.length) {
    const block = data.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return entries;
    const stored = Number.parseInt(field(block, 148, 8).trim(), 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
    if (stored !== sum) throw new Error("a tar header checksum does not match");
    const size = Number.parseInt(field(block, 124, 12), 8);
    const start = offset + BLOCK;
    if (field(block, 156, 1) !== "0") throw new Error("a tar entry is not a regular file");
    if (field(block, 257, 6) !== "ustar") throw new Error("a tar header is not ustar");
    if (!Number.isInteger(size) || start + size > data.length) throw new Error("a tar entry runs past the archive");
    entries.push({
      path: field(block, 0, 100),
      content: data.subarray(start, start + size).toString("utf8"),
      mode: Number.parseInt(field(block, 100, 8), 8),
      uid: Number.parseInt(field(block, 108, 8), 8),
      gid: Number.parseInt(field(block, 116, 8), 8),
      mtime: Number.parseInt(field(block, 136, 12), 8),
      typeflag: field(block, 156, 1),
      magic: field(block, 257, 6),
    });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("the tar archive has no end marker");
}
