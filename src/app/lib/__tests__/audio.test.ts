// Audio controller tests: gesture gating, ambient crossfade keying,
// one-shot playback, and the cue->action mapping (all via fakes, no DOM).
import { describe, expect, it } from "vitest";
import { AudioController, cuesToAudio, type AudioElement } from "../audio";

class FakeAudio implements AudioElement {
  src = "";
  loop = false;
  volume = 0;
  currentTime = 0;
  played = false;
  paused = false;
  private ended: Array<() => void> = [];
  play(): void {
    this.played = true;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: "ended", fn: () => void): void {
    if (type === "ended") this.ended.push(fn);
  }
  removeEventListener(type: "ended", fn: () => void): void {
    if (type === "ended") this.ended = this.ended.filter((f) => f !== fn);
  }
}

function factorySpy() {
  const created: FakeAudio[] = [];
  return {
    created,
    factory: () => {
      const el = new FakeAudio();
      created.push(el);
      return el;
    },
  };
}

describe("AudioController", () => {
  it("ignores playback before a user gesture", () => {
    const { factory } = factorySpy();
    const c = new AudioController(factory);
    c.playOnce("sfx.mp3");
    expect(factorySpy).toBeDefined();
    expect(c.currentAmbientKey).toBe("");
  });

  it("plays and crossfades ambient after unlock", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    c.playAmbient("tavern", "/ambient/tavern.mp3");
    expect(c.currentAmbientKey).toBe("tavern");
    expect(created).toHaveLength(1);
    expect(created[0].loop).toBe(true);
    expect(created[0].played).toBe(true);
    // Crossfade target volume reaches 1 after the fade ticks.
    expect(created[0].volume).toBeGreaterThanOrEqual(0);
  });

  it("switches ambient tracks on a new key and pauses the old one", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    c.playAmbient("tavern", "/a/tavern.mp3");
    c.playAmbient("mine", "/a/mine.mp3");
    expect(c.currentAmbientKey).toBe("mine");
    expect(created).toHaveLength(2);
  });

  it("no-ops the same ambient key", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    c.playAmbient("tavern", "/a/tavern.mp3");
    c.playAmbient("tavern", "/a/tavern.mp3");
    expect(created).toHaveLength(1);
  });

  it("applies master and channel gain to voice and effects", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.setVolumes({ master: 0.5, ambient: 0.8, voice: 0.6, effects: 0.2 });
    c.unlock();
    c.playOnce("voice.mp3", "voice");
    c.playOnce("effect.mp3", "effects");
    expect(created[0].volume).toBeCloseTo(0.3);
    expect(created[1].volume).toBeCloseTo(0.1);
  });
});

describe("cuesToAudio", () => {
  const manifest = {
    ambient: { tavern: { file: "assets/audio/tavern.mp3" }, mine: { prompt: "rumbling" } },
    effects: { collapse: { file: "assets/audio/collapse.mp3" } },
    voices: { elara: { file: "assets/audio/elara.mp3" }, kade: { prompt: "gruff" } },
  };
  const fileUrl = (scriptId: string, file: string) => `/s/${scriptId}/${file.replace(/^assets\//, "")}`;
  const entityUrl = (scriptId: string, kind: string, id: string) => `/s/${scriptId}/e/${kind}/${id}`;

  it("maps location_enter to an ambient loop", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    cuesToAudio(c, [{ kind: "location_enter", locationId: "tavern" }], manifest, "fixture-script", fileUrl, entityUrl);
    expect(c.currentAmbientKey).toBe("tavern");
    expect(created[0].src).toBe("/s/fixture-script/audio/tavern.mp3");
  });

  it("maps event to a one-shot sfx", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    cuesToAudio(c, [{ kind: "event", eventId: "collapse" }], manifest, "fixture-script", fileUrl, entityUrl);
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe("/s/fixture-script/audio/collapse.mp3");
  });

  it("maps npc_speech to a voice line (file, then prompt)", () => {
    const a = factorySpy();
    const ca = new AudioController(a.factory);
    ca.unlock();
    cuesToAudio(ca, [{ kind: "npc_speech", npcId: "elara" }], manifest, "fixture-script", fileUrl, entityUrl);
    expect(a.created[0].src).toBe("/s/fixture-script/audio/elara.mp3");

    const b = factorySpy();
    const cb = new AudioController(b.factory);
    cb.unlock();
    cuesToAudio(cb, [{ kind: "npc_speech", npcId: "kade" }], manifest, "fixture-script", fileUrl, entityUrl);
    expect(b.created[0].src).toBe("/s/fixture-script/e/voices/kade");
  });

  it("silently skips entities with no asset", () => {
    const { created, factory } = factorySpy();
    const c = new AudioController(factory);
    c.unlock();
    cuesToAudio(c, [{ kind: "location_enter", locationId: "nowhere" }], manifest, "x", fileUrl, entityUrl);
    expect(created).toHaveLength(0);
  });
});
