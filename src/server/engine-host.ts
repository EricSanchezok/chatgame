// EngineHost: the server-side session manager for the web UI.
// - Session registry (create/get/destroy, idle reaping)
// - Script library scanning (scripts/*/script.yaml -> meta + theme palette)
// - Asset file serving with path-traversal protection
// - Per-session serialization queue (concurrent turns on one session queue up)
// A globalThis singleton survives Next dev HMR (no double instances).
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Engine } from "../engine";
import { loadScript } from "../engine/loader";
import { listSelectableThemes, resolveTheme, buildAssetManifest, toThemeView, type ThemeView } from "../engine/presentation";
import { createProvider, type LLMProvider } from "../engine/narrative/provider";
import { createMediaProvider, type MediaProvider } from "../engine/media/provider";
import { importScriptFromZip, importScriptFromDir, defaultScriptsRoot } from "./script-import";
import { saveDirForScript, metaPathForScript, createDataStore, type SaveStore } from "../engine/save-store";
import type { WorldState, TurnResult, WorldDefinition } from "../engine/types";
import type { Theme } from "../script/schemas/theme";

export class HostError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HostError";
    this.status = status;
  }
}

export interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  tone: string[];
  language: string;
  /** Theme palette (undefined when the script ships no theme.yaml). */
  theme?: { id: string; name: string; palette: Theme["palette"] };
  /** Whether the script has a presentation asset manifest. */
  hasAssets: boolean;
  /** Content rating surface (empty strings when the script ships none). */
  safety?: { age_rating: string; content_classes: string[] };
}

/** Static catalog data for the UI panels (names/descriptions, never state). */
export interface CatalogView {
  locations: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    npcsPresent: string[];
    connections: Array<{ to: string; distance: number; travel_time: number }>;
  }>;
  items: Array<{ id: string; name: string; type: string; description: string }>;
  npcs: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  actions: Array<{ id: string; displayName: string }>;
  stats: Array<{ name: string; min: number; max: number }>;
  needs: Array<{ name: string }>;
  statusEffects: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; name: string }>;
  origins: Array<{ id: string; name: string }>;
  currency: { name: string; symbol: string };
  hpStat: string;
}

// ThemeView is the single flat theme DTO (defined in engine/presentation.ts).

export interface SessionRecord {
  id: string;
  scriptId: string;
  engine: Engine;
  lastActivity: number;
  /** True after any state-mutating operation since the last save. */
  dirty: boolean;
}

interface HostGlobal {
  __CHATGAME_ENGINE_HOST__?: EngineHost;
}

const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min idle reaping
const MAX_SESSIONS = 20;

/** MIME map for the whitelisted asset extensions. */
const MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export class EngineHost {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly scriptsRoot: string;
  private readonly provider: LLMProvider;
  private readonly media: MediaProvider;
  private readonly saveStore: SaveStore;

  constructor(options: { scriptsRoot?: string; saveStore?: SaveStore } = {}) {
    this.scriptsRoot = options.scriptsRoot ?? defaultScriptsRoot();
    this.saveStore = options.saveStore ?? createDataStore();
    this.provider = createProvider();
    this.media = createMediaProvider();
  }

  /** Singleton (globalThis-guarded against HMR double instances). */
  static get(): EngineHost {
    const g = globalThis as unknown as HostGlobal;
    const root = process.env.CHATGAME_SCRIPTS_ROOT;
    const dataRoot = process.env.CHATGAME_DATA_ROOT;
    const cacheKey = `${root ?? ""}:${dataRoot ?? ""}`;
    const cache = g as unknown as Record<string, EngineHost | undefined>;
    if (!cache[cacheKey]) {
      cache[cacheKey] = new EngineHost({
        scriptsRoot: root ? path.resolve(root) : undefined,
        saveStore: createDataStore(dataRoot),
      });
    }
    return cache[cacheKey] as EngineHost;
  }

  // -------------------------------------------------------------------------
  // Script library
  // -------------------------------------------------------------------------

  /** Lists installed scripts (script.yaml meta + theme palette when present). */
  listScripts(): ScriptSummary[] {
    this.reapIdle();
    const out: ScriptSummary[] = [];
    if (!existsSync(this.scriptsRoot)) return out;
    for (const entry of readdirSync(this.scriptsRoot)) {
      const dir = path.join(this.scriptsRoot, entry);
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      const scriptYaml = path.join(dir, "script.yaml");
      if (!existsSync(scriptYaml)) continue;
      try {
        const definition = loadScript(dir);
        const defaultTheme = definition.themes.get("default");
        out.push({
          id: definition.script.id,
          name: definition.script.name,
          description: definition.script.description,
          author: definition.script.author,
          tone: definition.script.tone,
          language: definition.script.language,
          theme: defaultTheme
            ? { id: defaultTheme.id, name: defaultTheme.name, palette: defaultTheme.palette }
            : undefined,
          hasAssets: definition.assets !== undefined,
          safety: {
            age_rating: definition.safety?.age_rating ?? "",
            content_classes: definition.safety?.content_classes ?? [],
          },
        });
      } catch {
        // Invalid scripts are invisible in the library (validate gate keeps
        // them out of scriptsRoot in the first place).
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /** Presentation surface for a script: selectable themes + asset index. */
  scriptPresentation(scriptId: string): {
    themes: ThemeView[];
    assets: boolean;
  } {
    const definition = this.loadDefinition(scriptId);
    return {
      themes: listSelectableThemes(definition).map((t) => toThemeView(t)),
      assets: definition.assets !== undefined,
    };
  }

  /** Static catalog for the UI panels (names/descriptions, never state). */
  scriptCatalog(scriptId: string): CatalogView {
    const definition = this.loadDefinition(scriptId);
    return {
      locations: [...definition.locations.values()].map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        description: l.description,
        npcsPresent: l.npcs_present,
        connections: l.connections.map((c) => ({
          to: c.to,
          distance: c.distance,
          travel_time: c.travel_time,
        })),
      })),
      items: [...definition.items.values()].map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        description: i.description,
      })),
      npcs: [...definition.npcs.values()].map((n) => ({ id: n.id, name: n.name })),
      events: [...definition.events.values()].map((e) => ({ id: e.id, name: e.name })),
      actions: definition.actions.actions.map((a) => ({
        id: a.id,
        displayName: a.display_name ?? a.id,
      })),
      stats: definition.mechanics.stats.map((s) => ({ name: s.name, min: s.min, max: s.max })),
      needs: (definition.mechanics.needs ?? []).map((n) => ({ name: n.name })),
      statusEffects: (definition.mechanics.status_effects ?? []).map((s) => ({
        id: s.id,
        name: s.name,
      })),
      tasks: [...definition.tasks.values()].map((t) => ({ id: t.id, name: t.name })),
      origins: [...definition.origins.values()].map((o) => ({ id: o.id, name: o.name })),
      currency: {
        name: definition.mechanics.currency.name,
        symbol: definition.mechanics.currency.symbol,
      },
      hpStat: definition.mechanics.combat.hp_stat,
    };
  }

  /** Asset manifest for a script (file paths + prompt placeholders). */
  scriptAssets(scriptId: string): ReturnType<typeof buildAssetManifest> {
    return buildAssetManifest(this.loadDefinition(scriptId));
  }

  /**
   * Lists save files for a script (no live session needed).
   * Internal retained API: no current caller, kept for future consumers.
   */
  scriptSaves(scriptId: string): string[] {
    this.scriptDirFor(scriptId); // 404 gate
    return this.saveStore.list(scriptId).map((s) => s.runId);
  }

  /** Lists an installed script's origins for the new-game flow. */
  scriptOrigins(scriptId: string): Array<{
    id: string;
    name: string;
    description: string;
    difficulty?: string;
  }> {
    const definition = this.loadDefinition(scriptId);
    return [...definition.origins.values()].map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      difficulty: o.difficulty,
    }));
  }

  /** Safety surface for a script (empty when the script ships no safety data). */
  scriptSafety(scriptId: string): { age_rating: string; content_classes: string[] } {
    const safety = this.loadDefinition(scriptId).safety;
    return {
      age_rating: safety?.age_rating ?? "",
      content_classes: safety?.content_classes ?? [],
    };
  }

  /** Imports a script zip (rejects duplicates unless replace). */
  importZip(zipBuffer: Buffer, replace = false): { scriptId: string; warnings: string[] } {
    const result = importScriptFromZip(zipBuffer, {
      scriptsRoot: this.scriptsRoot,
      replace,
    });
    return { scriptId: result.scriptId, warnings: result.warnings.map((w) => w.message) };
  }

  /** Imports a script directory (CLI path). */
  importDir(srcDir: string, replace = false): { scriptId: string; warnings: string[] } {
    const result = importScriptFromDir(srcDir, {
      scriptsRoot: this.scriptsRoot,
      replace,
    });
    return { scriptId: result.scriptId, warnings: result.warnings.map((w) => w.message) };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Creates a new session (or resumes a save by its run id). */
  createSession(options: {
    scriptId: string;
    /** Required for new games; ignored when loadRunId resumes a save. */
    originId?: string;
    seed?: number;
    playerName?: string;
    /** Save filename (basename, .json) to resume; rejects traversal. */
    loadRunId?: string;
  }): { id: string; state: WorldState; presentation: ReturnType<EngineHost["sessionPresentation"]> } {
    this.reapIdle();
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new HostError(`too many active sessions (max ${MAX_SESSIONS})`, 429);
    }
    const scriptDir = this.scriptDirFor(options.scriptId);
    let loadSaveFile: string | undefined;
    if (options.loadRunId) {
      if (options.loadRunId !== path.basename(options.loadRunId) || !options.loadRunId.endsWith(".json")) {
        throw new HostError("invalid save id", 400);
      }
      loadSaveFile = path.join(
        saveDirForScript(options.scriptId, this.saveStore.root ?? ".chatgame"),
        options.loadRunId,
      );
      if (!existsSync(loadSaveFile)) {
        throw new HostError("save not found", 404);
      }
    }
    const engine = Engine.create({
      scriptDir,
      // Resume path ignores the origin (the save owns the player); the
      // new-game route validates originId before calling in.
      originId: options.originId ?? "",
      seed: options.seed,
      playerName: options.playerName,
      loadSaveFile,
      provider: this.provider,
      saveStore: this.saveStore,
    });
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      scriptId: options.scriptId,
      engine,
      lastActivity: Date.now(),
      dirty: false,
    });
    return { id, state: engine.worldState, presentation: this.sessionPresentation(id) };
  }

  listSessions(): Array<{ id: string; scriptId: string }> {
    this.reapIdle();
    return [...this.sessions.values()].map((s) => ({ id: s.id, scriptId: s.scriptId }));
  }

  /** Serializes async operations per session (turns/advances queue up). */
  private enqueue<T>(sessionId: string, op: (session: SessionRecord) => Promise<T> | T): Promise<T> {
    const record = this.requireSession(sessionId);
    const tail = this.queues.get(sessionId) ?? Promise.resolve();
    const next = tail.then(
      () => op(record),
      () => op(record),
    );
    this.queues.set(sessionId, next.catch(() => undefined));
    return next;
  }

  /** Runs one player turn; auto-saves + merges meta after success. */
  turn(sessionId: string, input: string): Promise<TurnResult> {
    return this.enqueue(sessionId, async (session) => {
      const result = await session.engine.playerTurn(input);
      session.lastActivity = Date.now();
      session.dirty = true;
      // Every completed turn lands in the fixed autosave slot (no
      // debounce: the write is millisecond-cheap and a turn is the natural
      // merge point). Manual saves keep their own timestamped files.
      session.engine.save("autosave");
      // Meta-progression is merged on every turn so unlocks survive a
      // refresh even before the player explicitly saves or dies.
      this.writeMeta(session.id);
      return result;
    });
  }

  /** Offline advance (serialized per session; death policy runs inside). */
  advance(sessionId: string, hours: number): Promise<WorldState> {
    return this.enqueue(sessionId, (session) => {
      const state = session.engine.advance(hours);
      session.lastActivity = Date.now();
      session.dirty = true;
      return state;
    });
  }

  /** Saves the session to disk; returns the file path. */
  save(sessionId: string, runId?: string): Promise<string> {
    return this.enqueue(sessionId, (session) => {
      const filePath = session.engine.save(runId);
      session.lastActivity = Date.now();
      session.dirty = false;
      return filePath;
    });
  }

  /** Lists existing save files for the session's script. */
  listSaves(sessionId: string): string[] {
    const record = this.requireSession(sessionId);
    return record.engine.saves();
  }

  /** Save file metadata (filename + mtime) for the launcher's continue list. */
  saveSummaries(scriptId: string): Array<{ runId: string; updatedAt: string }> {
    this.scriptDirFor(scriptId); // 404 gate
    // stat.mtime only — no per-file JSON.parse.
    return this.saveStore.list(scriptId);
  }

  /**
   * Merges the session's currently granted origins into the script's
   * meta-progression file (.chatgame/meta/<scriptId>.json) and writes it
   * back atomically. A corrupt/missing file is treated as an empty set.
   */
  writeMeta(sessionId: string): string[] {
    const record = this.requireSession(sessionId);
    const scriptId = record.scriptId;
    const granted = record.engine.unlockedOrigins();
    const metaPath = metaPathForScript(scriptId, this.saveStore.root ?? ".chatgame");
    let existing: string[] = [];
    try {
      if (existsSync(metaPath)) {
        const raw = JSON.parse(readFileSync(metaPath, "utf8")) as { unlockedOrigins?: unknown };
        if (Array.isArray(raw.unlockedOrigins)) {
          existing = raw.unlockedOrigins.filter((x): x is string => typeof x === "string");
        }
      }
    } catch {
      // Corrupt meta file: rebuild from the session's unlocks.
    }
    const merged = [...new Set([...existing, ...granted])];
    mkdirSync(path.dirname(metaPath), { recursive: true });
    const tmp = `${metaPath}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ unlockedOrigins: merged, updatedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    renameSync(tmp, metaPath);
    return merged;
  }

  /**
   * Read-only view of the script's meta-progression: unlocked origins
   * (union across runs) plus the set of origins that *can* be unlocked
   * (from run.yaml unlocks[].grant) — the launcher derives "default
   * origins" as `all origins − lockable ∪ unlocked`.
   */
  readMeta(scriptId: string): {
    unlockedOrigins: string[];
    lockableOrigins: string[];
    updatedAt: string | null;
  } {
    const definition = this.loadDefinition(scriptId); // 404 gate
    const lockable = [
      ...new Set(
        definition.run.meta_progression.unlocks.flatMap((u) => u.grant),
      ),
    ];
    const metaPath = metaPathForScript(scriptId, this.saveStore.root ?? ".chatgame");
    try {
      if (!existsSync(metaPath)) {
        return { unlockedOrigins: [], lockableOrigins: lockable, updatedAt: null };
      }
      const raw = JSON.parse(readFileSync(metaPath, "utf8")) as {
        unlockedOrigins?: unknown;
        updatedAt?: unknown;
      };
      return {
        unlockedOrigins: Array.isArray(raw.unlockedOrigins)
          ? raw.unlockedOrigins.filter((x): x is string => typeof x === "string")
          : [],
        lockableOrigins: lockable,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
      };
    } catch {
      return { unlockedOrigins: [], lockableOrigins: lockable, updatedAt: null };
    }
  }

  /**
   * Loads a save file into the session by its run id (filename inside the
   * script's save dir). Traversal outside the save dir is rejected.
   */
  load(sessionId: string, runId: string): WorldState {
    const record = this.requireSession(sessionId);
    if (runId !== path.basename(runId) || !runId.endsWith(".json")) {
      throw new HostError("invalid save id", 400);
    }
    const filePath = path.join(
      saveDirForScript(record.scriptId, this.saveStore.root ?? ".chatgame"),
      runId,
    );
    if (!existsSync(filePath)) {
      throw new HostError("save not found", 404);
    }
    const state = record.engine.load(filePath);
    record.lastActivity = Date.now();
    record.dirty = false;
    return state;
  }

  /** User edit to a descriptor (explanation layer only). */
  setDescriptor(
    sessionId: string,
    descriptorPath: Parameters<Engine["setDescriptor"]>[0],
    text: string,
  ): WorldState {
    const record = this.requireSession(sessionId);
    const state = record.engine.setDescriptor(descriptorPath, text);
    record.lastActivity = Date.now();
    record.dirty = true;
    return state;
  }

  /** Current world state for a session. */
  state(sessionId: string): WorldState {
    return this.requireSession(sessionId).engine.worldState;
  }

  /** Presentation surface for a live session (themes + current location). */
  sessionPresentation(sessionId: string): {
    themes: ThemeView[];
    currentTheme: ThemeView;
    hasAssets: boolean;
  } {
    const record = this.requireSession(sessionId);
    const definition = record.engine.definition;
    const current = resolveTheme(definition, record.engine.worldState);
    return {
      themes: listSelectableThemes(definition).map((t) => toThemeView(t)),
      currentTheme: toThemeView(current),
      hasAssets: definition.assets !== undefined,
    };
  }

  /** Destroys a session (unsaved changes are discarded). */
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.queues.delete(sessionId);
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  /**
   * Resolves an entity asset to bytes: declared file first, then prompt
   * generation via the media provider (cached in .chatgame/media-cache/).
   * Returns null when the entity has no asset and no usable prompt.
   */
  async resolveAsset(
    scriptId: string,
    kind: keyof ReturnType<typeof buildAssetManifest>,
    entityId: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    const manifest = buildAssetManifest(this.loadDefinition(scriptId));
    const entry = manifest[kind][entityId];
    if (!entry) return null;
    if (entry.file) return this.readAsset(scriptId, entry.file);
    if (!entry.prompt) return null;
    const isAudio = kind === "voices" || kind === "ambient" || kind === "effects";
    const ext = isAudio ? "wav" : "svg";
    const cacheDir = path.join(".chatgame", "media-cache", scriptId, kind);
    const cachePath = path.join(cacheDir, `${entityId}.${ext}`);
    if (existsSync(cachePath)) {
      return { data: readFileSync(cachePath), mimeType: MIME_BY_EXT[`.${ext}`] };
    }
    const generated = isAudio
      ? await this.media.generateSpeech(entry.prompt, entry.profile)
      : await this.media.generateImage(entry.prompt);
    if (!generated) return null;
    const comma = generated.dataUri.indexOf(",");
    const bytes = Buffer.from(generated.dataUri.slice(comma + 1), "base64");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, bytes);
    return { data: bytes, mimeType: generated.mimeType };
  }

  /**
   * Reads an asset file safely. The asset path must resolve inside the
   * script's assets/ directory (traversal-proof).
   */
  readAsset(scriptId: string, relPath: string): { data: Buffer; mimeType: string } {
    const scriptDir = this.scriptDirFor(scriptId);
    const base = path.resolve(scriptDir, "assets");
    const abs = path.resolve(base, relPath);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new HostError("invalid asset path", 400);
    }
    const ext = path.extname(abs).toLowerCase();
    if (!(ext in MIME_BY_EXT)) {
      throw new HostError(`unsupported asset type "${ext}"`, 400);
    }
    if (!existsSync(abs) || !statSync(abs, { throwIfNoEntry: false })?.isFile()) {
      throw new HostError("asset not found", 404);
    }
    return { data: readFileSync(abs), mimeType: MIME_BY_EXT[ext] };
  }

  /**
   * The active media provider (mock/off; real provider is a V2 addition).
   * Internal retained API: no current caller, kept for future consumers.
   */
  get mediaProvider(): MediaProvider {
    return this.media;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private scriptDirFor(scriptId: string): string {
    const dir = path.join(this.scriptsRoot, scriptId);
    if (!existsSync(path.join(dir, "script.yaml"))) {
      throw new HostError(`script "${scriptId}" is not installed`, 404);
    }
    return dir;
  }

  private loadDefinition(scriptId: string): WorldDefinition {
    return loadScript(this.scriptDirFor(scriptId));
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new HostError("session not found", 404);
    record.lastActivity = Date.now();
    return record;
  }

  /** Removes sessions idle beyond SESSION_IDLE_MS. */
  private reapIdle(): void {
    const now = Date.now();
    for (const [id, record] of this.sessions) {
      if (now - record.lastActivity > SESSION_IDLE_MS) {
        this.sessions.delete(id);
        this.queues.delete(id);
      }
    }
  }
}
