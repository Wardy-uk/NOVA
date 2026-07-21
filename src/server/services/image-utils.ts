// Lightweight image inspection — reads pixel dimensions straight from the
// base64 header bytes so we can screen images before sending them to a vision
// model. No native dependency (avoids pulling sharp onto the prod box).
//
// Anthropic rejects "many-image" requests where any image exceeds 2000px on a
// side (400 invalid_request_error). We use this to drop oversized images and
// cap how many we attach, rather than failing the whole triage call.

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Parse width/height from a base64-encoded image. Supports PNG, JPEG and GIF —
 * the formats screenshots actually arrive in. Returns null when the format is
 * unrecognised or the header is truncated.
 */
export function getImageDimensions(base64: string, mimeType: string): ImageDimensions | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (buf.length < 10) return null;

  // PNG: 8-byte signature, then IHDR chunk with width@16, height@20 (big-endian)
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: "GIF87a"/"GIF89a", width@6, height@8 (little-endian)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // JPEG: starts FFD8, scan segments for a Start-Of-Frame marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      const marker = buf[offset + 1];
      // SOF markers carry the frame dimensions (exclude DHT/JPG/DAC: C4/C8/CC)
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      // Standalone markers (RSTn, SOI, EOI) have no length payload
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segLength = buf.readUInt16BE(offset + 2);
      if (segLength < 2) return null;
      offset += 2 + segLength;
    }
  }

  return null;
}

export interface ImageScreenOptions {
  maxDimension: number;   // drop images whose largest side exceeds this
  maxCount: number;       // cap the number of images attached
  maxBytes: number;       // backstop for images whose dimensions can't be read
}

export interface ScreenedImage {
  base64: string;
  mimeType: string;
}

export interface ImageScreenResult<T extends ScreenedImage> {
  kept: T[];
  skipped: Array<{ image: T; reason: string }>;
}

/**
 * Filter a list of images down to what a vision model will accept: drop those
 * exceeding maxDimension (or maxBytes when dimensions are unreadable) and cap
 * the total count. Order is preserved; the first maxCount survivors are kept.
 */
export function screenImages<T extends ScreenedImage>(
  images: T[],
  opts: ImageScreenOptions,
): ImageScreenResult<T> {
  const kept: T[] = [];
  const skipped: Array<{ image: T; reason: string }> = [];

  for (const image of images) {
    if (kept.length >= opts.maxCount) {
      skipped.push({ image, reason: `image cap of ${opts.maxCount} reached` });
      continue;
    }
    const dims = getImageDimensions(image.base64, image.mimeType);
    if (dims) {
      const largest = Math.max(dims.width, dims.height);
      if (largest > opts.maxDimension) {
        skipped.push({ image, reason: `${dims.width}x${dims.height} exceeds ${opts.maxDimension}px limit` });
        continue;
      }
    } else {
      // Unknown dimensions — fall back to a byte-size backstop
      const bytes = Math.floor(image.base64.length * 0.75);
      if (bytes > opts.maxBytes) {
        skipped.push({ image, reason: `unknown dimensions, ${(bytes / 1024).toFixed(0)}KB exceeds backstop` });
        continue;
      }
    }
    kept.push(image);
  }

  return { kept, skipped };
}
