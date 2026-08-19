// Mock media provider: deterministic placeholder generation for tests and
// offline demo. Images are simple SVG data URIs derived from the prompt
// (stable per prompt); speech is a tiny silent WAV data URI. Both prove the
// full media pipeline without any network or model dependency.
import type { MediaGenerationResult, MediaProvider } from "./provider";

/** Stable 32-bit string hash (FNV-1a) for deterministic palette picks. */
function hashStr(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic SVG placeholder image (gradient + prompt initials). */
function placeholderSvg(prompt: string): string {
  const hue = hashStr(prompt) % 360;
  const hue2 = (hue + 60) % 360;
  const label = prompt.slice(0, 12).replace(/[<>&"]/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},45%,32%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2},50%,22%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="256" height="256" fill="url(#g)"/>` +
    `<text x="128" y="132" text-anchor="middle" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,0.75)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Minimal silent WAV (0.05s, 8kHz mono) as a data URI. */
const SILENT_WAV =
  "data:audio/wav;base64," +
  Buffer.from(
    // RIFF header + fmt + data chunk with 400 zero samples.
    (() => {
      const b = Buffer.alloc(44 + 400);
      b.write("RIFF", 0);
      b.writeUInt32LE(36 + 400, 4);
      b.write("WAVE", 8);
      b.write("fmt ", 12);
      b.writeUInt32LE(16, 16);
      b.writeUInt16LE(1, 20);
      b.writeUInt16LE(1, 22);
      b.writeUInt32LE(8000, 24);
      b.writeUInt32LE(8000, 28);
      b.writeUInt16LE(1, 32);
      b.writeUInt16LE(8, 34);
      b.write("data", 36);
      b.writeUInt32LE(400, 40);
      return b;
    })(),
  ).toString("base64");

export class MockMediaProvider implements MediaProvider {
  async generateImage(prompt: string): Promise<MediaGenerationResult | null> {
    return { dataUri: placeholderSvg(prompt), mimeType: "image/svg+xml" };
  }

  async generateSpeech(): Promise<MediaGenerationResult | null> {
    return { dataUri: SILENT_WAV, mimeType: "audio/wav" };
  }
}
