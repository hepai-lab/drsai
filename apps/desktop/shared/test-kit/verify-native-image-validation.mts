/**
 * Native image attachment validation contract.
 *
 * `chat.ts` decides whether an attached image is a real image before it stages
 * it into the workspace. That decision must answer "is this a well-formed image
 * of this format?", not "is this file byte-for-byte a canonical encoder output?".
 *
 * The distinction is not academic. A JPEG whose EOI marker is not the final two
 * bytes (camera software, EXIF writers and some encoders append data after EOI)
 * was rejected with "Image is corrupt or uses an unsupported format", so a
 * perfectly good phone photo could not be sent. The same class of over-strict
 * assumption existed for PNG (IEND must end the file, strict per-chunk CRC,
 * 45-byte floor), GIF (0x3b trailer at the exact last byte) and WebP (the RIFF
 * declared size must equal the file length exactly).
 *
 * These fixtures pin the lenient semantics so the strict variant cannot come
 * back. Only `detectImageMime` is exercised: it is the single gate every image
 * attachment flows through (paste, drag-drop, file picker).
 */
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

// chat.ts imports Electron-bound modules at load time. This test only needs the
// pure byte-level detector, so re-derive the four functions from source instead
// of importing the module. Keeping the extraction explicit (rather than copying
// the bodies) means the test fails loudly if a function disappears or is
// renamed, and can never silently pass against a stale duplicate.
const chatSource = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../main/chat.ts", import.meta.url), "utf8"),
);

function extractFunction(name: string): string {
  const start = chatSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in shared/main/chat.ts`);
  let depth = 0;
  let index = chatSource.indexOf("{", start);
  for (; index < chatSource.length; index += 1) {
    const char = chatSource[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `${name} must have balanced braces`);
  return stripTypeAnnotations(chatSource.slice(start, index + 1));
}

/**
 * `new Function` compiles JavaScript, so the extracted TypeScript annotations
 * have to go. Only the small, regular subset these four functions use is
 * handled — parameter and return annotations, and `import type`-style local
 * declarations. Anything it cannot strip is left alone and will fail loudly at
 * compile time rather than being silently mis-translated.
 */
function stripTypeAnnotations(source: string): string {
  return source
    // Drop `: Type` annotations. The type is everything up to the delimiter that
    // ends the annotation: `,` `)` `;` `=` `{` or end of line.
    .replace(/:\s*[A-Za-z_$][\w$.<>\[\]]*(\s*\|\s*[A-Za-z_$][\w$.<>\[\]]*)*/g, "")
    .replace(/\bas\s+[A-Za-z_$][\w$.<>\[\]]*/g, "");
}

const factory = new Function(
  `${extractFunction("crc32")}
   ${extractFunction("isStructurallyValidPng")}
   ${extractFunction("isStructurallyValidJpeg")}
   ${extractFunction("detectImageMime")}
   return detectImageMime;`,
);
const detectImageMime = factory() as (bytes: Buffer) => string | undefined;

// --- fixtures -------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Of(body));
  return Buffer.concat([length, body, crc]);
}

function crc32Of(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(width: number, height: number, options: { trailing?: number; breakCrc?: boolean } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height); // filter byte + RGBA pixels
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))];
  let png = Buffer.concat([PNG_SIGNATURE, ...chunks]);
  if (options.breakCrc) png[png.length - 1] ^= 0xff; // corrupt the IEND CRC
  if (options.trailing) png = Buffer.concat([png, Buffer.alloc(options.trailing, 0x20)]);
  return png;
}

/** Minimal but structurally real baseline JPEG (SOI/APP0/DQT/SOF0/DHT/SOS/EOI). */
function makeJpeg(options: { trailing?: number; truncatedTail?: boolean } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  // APP0/JFIF
  const app0 = Buffer.concat([Buffer.from("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  parts.push(Buffer.from([0xff, 0xe0]), u16(app0.length + 2), app0);
  // DQT (65 bytes payload)
  parts.push(Buffer.from([0xff, 0xdb]), u16(67), Buffer.alloc(65, 0x10));
  // SOF0: length 11, precision, height, width, 1 component
  const sof = Buffer.concat([Buffer.from([8]), u16(1), u16(1), Buffer.from([1, 0x11, 0x00])]);
  parts.push(Buffer.from([0xff, 0xc0]), u16(sof.length + 2), sof);
  // DHT (placeholder payload)
  parts.push(Buffer.from([0xff, 0xc4]), u16(20), Buffer.alloc(18, 0));
  // SOS: length 8, 1 component selector, spectral bytes
  const sos = Buffer.from([1, 0x01, 0x00, 0, 63, 0]);
  parts.push(Buffer.from([0xff, 0xda]), u16(sos.length + 2), sos);
  parts.push(Buffer.from([0x00, 0x11, 0x22, 0x33])); // entropy-coded data
  parts.push(Buffer.from([0xff, 0xd9])); // EOI
  const jpeg = Buffer.concat(parts);
  if (options.truncatedTail) return jpeg.subarray(0, jpeg.length - 40);
  if (options.trailing) return Buffer.concat([jpeg, Buffer.alloc(options.trailing, 0x00)]);
  return jpeg;
}

function makeGif(options: { trailing?: number; trailer?: boolean } = {}): Buffer {
  const header = Buffer.concat([
    Buffer.from("GIF89a", "ascii"),
    u16le(2), u16le(2), // logical screen 2x2
    Buffer.from([0x00, 0x00, 0x00]),
  ]);
  const body = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b]);
  const gif = Buffer.concat([header, body]);
  const withTrailer = options.trailer === false ? gif.subarray(0, gif.length - 1) : gif;
  return options.trailing ? Buffer.concat([withTrailer, Buffer.alloc(options.trailing, 0x00)]) : withTrailer;
}

function makeWebp(options: { trailing?: number } = {}): Buffer {
  const payload = Buffer.concat([
    Buffer.from("VP8 ", "ascii"),
    u32le(10),
    Buffer.alloc(10, 0),
  ]);
  const riffSize = 4 + payload.length; // "WEBP" + chunk
  const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), u32le(riffSize), Buffer.from("WEBP", "ascii"), payload]);
  return options.trailing ? Buffer.concat([webp, Buffer.alloc(options.trailing, 0x00)]) : webp;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}
function u16le(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}
function u32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

// --- baseline formats -----------------------------------------------------

assert.equal(detectImageMime(makePng(2, 2)), "image/png", "a canonical PNG must be detected");
assert.equal(detectImageMime(makeJpeg()), "image/jpeg", "a canonical JPEG must be detected");
assert.equal(detectImageMime(makeGif()), "image/gif", "a canonical GIF must be detected");
assert.equal(detectImageMime(makeWebp()), "image/webp", "a canonical WebP must be detected");

// --- regression: bytes appended after the trailing marker -----------------
// This is the reported bug. A phone photo with trailing bytes after EOI was
// rejected as "corrupt or unsupported", so the user could not send it at all.

assert.equal(
  detectImageMime(makeJpeg({ trailing: 512 })),
  "image/jpeg",
  "a JPEG with data appended after EOI is still a JPEG (was rejected before the fix)",
);
assert.equal(
  detectImageMime(makeJpeg({ trailing: 1 })),
  "image/jpeg",
  "even a single trailing byte after EOI must not reject a JPEG",
);
assert.equal(
  detectImageMime(makePng(2, 2, { trailing: 64 })),
  "image/png",
  "data appended after IEND must not reject a PNG",
);
assert.equal(
  detectImageMime(makeGif({ trailing: 64 })),
  "image/gif",
  "data appended after the GIF trailer must not reject a GIF",
);
assert.equal(
  detectImageMime(makeWebp({ trailing: 64 })),
  "image/webp",
  "a RIFF size smaller than the file length must not reject a WebP",
);

// A GIF without its trailer is still identifiable from its signature and a
// sane logical screen descriptor.
assert.equal(detectImageMime(makeGif({ trailer: false })), "image/gif", "a GIF trailer is optional for format detection");

// --- regression: size floors ----------------------------------------------
// 1x1 is a legal image. The previous 45-byte PNG floor and 14-byte GIF floor
// rejected small valid files.

assert.equal(detectImageMime(makePng(1, 1)), "image/png", "a 1x1 PNG is a valid image");
assert.equal(detectImageMime(makeGif()), "image/gif", "a minimal GIF is a valid image");

// --- regression: benign CRC mismatch --------------------------------------
// A rewritten chunk with a stale CRC is corruption, not a different file type.

assert.equal(
  detectImageMime(makePng(2, 2, { breakCrc: true })),
  "image/png",
  "a PNG with a stale chunk CRC must still be reported as a PNG",
);

// --- still rejected: genuinely broken or foreign input --------------------

assert.equal(detectImageMime(Buffer.alloc(0)), undefined, "empty input is not an image");
assert.equal(detectImageMime(Buffer.from("this is a text file, not an image")), undefined, "text is not an image");
assert.equal(
  detectImageMime(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4)])),
  undefined,
  "a truncated JPEG header with no frame is not an image",
);
assert.equal(
  detectImageMime(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(8)])),
  undefined,
  "a PNG signature with no IHDR is not an image",
);
assert.equal(
  detectImageMime(makeJpeg().subarray(0, 20)),
  undefined,
  "a JPEG truncated before its frame header has no usable dimensions",
);
assert.equal(
  detectImageMime(Buffer.concat([Buffer.from("RIFF"), u32le(4), Buffer.from("WAVE"), Buffer.alloc(16)])),
  undefined,
  "a RIFF container that is not WEBP is not an image",
);

// A PNG whose IHDR declares zero dimensions is malformed and must not pass.
const zeroWidthPng = Buffer.concat([
  PNG_SIGNATURE,
  pngChunk("IHDR", Buffer.concat([u32le(0).swap32(), u32le(2), Buffer.from([8, 6, 0, 0, 0])])),
  pngChunk("IEND", Buffer.alloc(0)),
]);
assert.equal(detectImageMime(zeroWidthPng), undefined, "a PNG with zero width is not a usable image");

process.stdout.write("verify-native-image-validation: ok\n");
