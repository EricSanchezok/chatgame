// AudioController: the single audio sink for the game UI. Ambient loops
// crossfade (800ms), voice/sfx play one-shot, and everything is gated on a
// user gesture (browser autoplay policy). Missing files silently skip.
//
// Testable in node: the HTMLAudioElement surface is injected, so tests can
// use fakes and assert the cue->element mapping without a browser.

export interface AudioElement {
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: "ended", fn: () => void): void;
  removeEventListener(type: "ended", fn: () => void): void;
}

export type AudioFactory = () => AudioElement;

/** Web-standard factory (used by the UI; browser-only). */
export function htmlAudioFactory(): AudioFactory {
  return () => new Audio() as AudioElement;
}

const AMBIENT_FADE_MS = 800;
const FADE_STEPS = 16;

export class AudioController {
  private readonly factory: AudioFactory;
  private ambient: AudioElement | null = null;
  private ambientKey = "";
  private enabled = false;

  constructor(factory: AudioFactory = htmlAudioFactory()) {
    this.factory = factory;
  }

  /** Unlocks playback after a user gesture. */
  unlock(): void {
    this.enabled = true;
  }

  /** Mutes everything without destroying state (settings toggle). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.ambient) this.ambient.pause();
  }

  /** Current ambient track key (for tests). */
  get currentAmbientKey(): string {
    return this.ambientKey;
  }

  /** Crossfades to a new ambient loop; same key is a no-op. */
  playAmbient(key: string, src: string): void {
    if (!this.enabled || !src) return;
    if (key === this.ambientKey && this.ambient) return;
    const next = this.factory();
    next.src = src;
    next.loop = true;
    next.volume = 0;
    const prev = this.ambient;
    this.ambient = next;
    this.ambientKey = key;
    void next.play();
    this.fade(next, 0, 1, AMBIENT_FADE_MS);
    if (prev) {
      this.fade(prev, prev.volume, 0, AMBIENT_FADE_MS, () => prev.pause());
    }
  }

  /** One-shot voice/sfx. */
  playOnce(src: string): void {
    if (!this.enabled || !src) return;
    const el = this.factory();
    el.src = src;
    el.volume = 1;
    const onEnded = () => el.removeEventListener("ended", onEnded);
    el.addEventListener("ended", onEnded);
    void el.play();
  }

  /** Stops ambient playback (leaving the game). */
  stopAll(): void {
    if (this.ambient) {
      this.ambient.pause();
      this.ambient = null;
      this.ambientKey = "";
    }
  }

  private fade(el: AudioElement, from: number, to: number, ms: number, done?: () => void): void {
    const stepMs = ms / FADE_STEPS;
    let step = 0;
    const tick = () => {
      step += 1;
      const t = step / FADE_STEPS;
      el.volume = from + (to - from) * t;
      if (step < FADE_STEPS) {
        setTimeout(tick, stepMs);
      } else if (done) {
        done();
      }
    };
    el.volume = from;
    tick();
  }
}

/** Maps engine media cues to audio actions given the asset manifest. */
export function cuesToAudio(
  controller: AudioController,
  cues: Array<{ kind: string; npcId?: string; locationId?: string; eventId?: string }>,
  manifest: {
    ambient: Record<string, { file?: string; prompt?: string }>;
    effects: Record<string, { file?: string; prompt?: string }>;
    voices: Record<string, { file?: string; prompt?: string }>;
  },
  scriptId: string,
  fileUrl: (scriptId: string, file: string) => string,
  entityUrl: (scriptId: string, kind: string, entityId: string) => string,
): void {
  const srcFor = (
    entry: { file?: string; prompt?: string } | undefined,
    kind: string,
    id: string,
  ): string => {
    if (!entry) return "";
    if (entry.file) return fileUrl(scriptId, entry.file);
    if (entry.prompt) return entityUrl(scriptId, kind, id);
    return "";
  };
  for (const cue of cues) {
    if (cue.kind === "location_enter" && cue.locationId) {
      controller.playAmbient(
        cue.locationId,
        srcFor(manifest.ambient[cue.locationId], "ambient", cue.locationId),
      );
      continue;
    }
    if (cue.kind === "event" && cue.eventId) {
      const src = srcFor(manifest.effects[cue.eventId], "effects", cue.eventId);
      if (src) controller.playOnce(src);
      continue;
    }
    if (cue.kind === "npc_speech" && cue.npcId) {
      const src = srcFor(manifest.voices[cue.npcId], "voices", cue.npcId);
      if (src) controller.playOnce(src);
    }
  }
}
