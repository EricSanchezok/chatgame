// Media provider interface: the thin seam for future text-to-image and
// text-to-speech generation. v1 ships off (no-op) and mock (deterministic
// data URIs for tests/demo); a real AI SDK provider is a V2 addition.
// The engine never *requires* media generation — missing media degrades
// gracefully (initial-letter avatars, silent audio).
import { MockMediaProvider } from "./mock";

export interface MediaGenerationResult {
  /** data: URI (image or audio) — frontend-consumable without a second fetch. */
  dataUri: string;
  /** Content type for rendering decisions (image/svg or audio). */
  mimeType: string;
}

export interface MediaProvider {
  /** Generates a placeholder/reference image from a prompt. Returns null when unavailable. */
  generateImage(prompt: string): Promise<MediaGenerationResult | null>;
  /** Generates speech audio for a text line with an optional voice profile. Returns null when unavailable. */
  generateSpeech(text: string, voiceProfile?: string): Promise<MediaGenerationResult | null>;
}

/** No-op provider: every generation returns null (graceful degradation). */
export class OffMediaProvider implements MediaProvider {
  async generateImage(): Promise<MediaGenerationResult | null> {
    return null;
  }
  async generateSpeech(): Promise<MediaGenerationResult | null> {
    return null;
  }
}

/** Env factory: CHATGAME_MEDIA_PROVIDER=mock|off (default off). */
export function createMediaProvider(
  env: NodeJS.ProcessEnv = process.env,
): MediaProvider {
  const kind = env.CHATGAME_MEDIA_PROVIDER ?? "off";
  switch (kind) {
    case "off":
      return new OffMediaProvider();
    case "mock":
      return new MockMediaProvider();
    default:
      throw new Error(`unknown CHATGAME_MEDIA_PROVIDER "${kind}" (expected "off" | "mock")`);
  }
}
