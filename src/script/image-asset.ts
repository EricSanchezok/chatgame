import { createHash } from "node:crypto";

export const MAX_WORLD_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_WORLD_ASSET_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_WORLD_ASSET_DIMENSION = 4096;

export interface InspectedImageAsset {
  hash: string;
  mime: "image/png" | "image/webp" | "image/avif";
  width: number;
  height: number;
}

function uint24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function pngDimensions(buffer: Buffer): Omit<InspectedImageAsset, "hash"> | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) return undefined;
  let offset = 8;
  let width = 0;
  let height = 0;
  let first = true;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error("malformed PNG chunk structure");
    const kind = buffer.toString("ascii", offset + 4, offset + 8);
    if (first && (kind !== "IHDR" || length !== 13)) throw new Error("PNG must begin with a valid IHDR chunk");
    first = false;
    if (kind === "IHDR") {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (kind === "acTL") throw new Error("animated PNG assets are not allowed");
    if (kind === "IEND") {
      if (length !== 0 || end !== buffer.length) throw new Error("malformed PNG ending");
      return { mime: "image/png", width, height };
    }
    offset = end;
  }
  throw new Error("PNG image is missing IEND");
}

function webpDimensions(buffer: Buffer): Omit<InspectedImageAsset, "hash"> | undefined {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return undefined;
  }
  const kind = buffer.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    if ((buffer[20] & 0b10) !== 0) throw new Error("animated WebP assets are not allowed");
    return { mime: "image/webp", width: uint24LE(buffer, 24) + 1, height: uint24LE(buffer, 27) + 1 };
  }
  if (kind === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { mime: "image/webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  throw new Error("unsupported WebP bitstream");
}

function avifDimensions(buffer: Buffer): Omit<InspectedImageAsset, "hash"> | undefined {
  if (buffer.length < 24 || buffer.toString("ascii", 4, 8) !== "ftyp") return undefined;
  const brands = buffer.subarray(8, Math.min(buffer.length, 64)).toString("ascii");
  if (!brands.includes("avif") && !brands.includes("mif1")) return undefined;
  if (brands.includes("avis") || buffer.includes(Buffer.from("anim"))) {
    throw new Error("animated AVIF assets are not allowed");
  }
  const marker = Buffer.from("ispe");
  const offset = buffer.indexOf(marker);
  if (offset < 4 || offset + 16 > buffer.length) throw new Error("AVIF dimensions are missing");
  return { mime: "image/avif", width: buffer.readUInt32BE(offset + 8), height: buffer.readUInt32BE(offset + 12) };
}

export function inspectImageAsset(buffer: Buffer): InspectedImageAsset {
  if (buffer.length === 0 || buffer.length > MAX_WORLD_ASSET_BYTES) {
    throw new Error("image asset must be between 1 byte and 4 MiB");
  }
  const inspected = pngDimensions(buffer) ?? webpDimensions(buffer) ?? avifDimensions(buffer);
  if (!inspected) throw new Error("asset must be a real PNG, WebP, or AVIF image");
  if (inspected.width < 1 || inspected.height < 1 ||
    inspected.width > MAX_WORLD_ASSET_DIMENSION || inspected.height > MAX_WORLD_ASSET_DIMENSION) {
    throw new Error("image dimensions must be between 1 and 4096 pixels");
  }
  return {
    ...inspected,
    hash: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  };
}
