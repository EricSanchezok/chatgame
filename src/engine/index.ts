// Engine facade: the single public entry point for the runtime.
//   createSession() -> load script + generate world
//   playerTurn(input) -> full PDVA turn loop (intent -> legality ->
//     resolution -> commitment/director -> narrative -> consistency ->
//     descriptor refresh)
//   advance(hours) -> deterministic offline world progression
//   save() / loadSave() -> JSON snapshots
import type { WorldDefinition, WorldState, SessionOptions, TurnResult } from "./types";
import type { DescriptorPath } from "./descriptors";
import { loadScript } from "./loader";
import { generateWorld } from "./worldgen";
import { resolveAction } from "./actions";
import { checkCommitments } from "./plot";
import { selectDirectorEvent, directorShouldSelect } from "./director";
import { applyDeathPolicy } from "./run";
import { applyEffects } from "./effect";
import { refreshAllStale, setUserDescriptor } from "./descriptors";
import { writeSave, readSave, listSaves } from "./save";
import { applyNeedDecay } from "./mechanics/needs";
import { tickStatuses } from "./mechanics/status";
import { advanceClock, absoluteDay } from "./time";
import { createProvider, type LLMProvider } from "./narrative/provider";
import { parseIntent } from "./narrative/intent";
import { generateNarrative, fallbackNarrative, type NarrativeOutput } from "./narrative/narrative";
import { withConsistencyRetry, tagsToEffects } from "./narrative/consistency";
import { buildTurnPrompt } from "./narrative/prompt";

export interface EngineOptions extends SessionOptions {
  /** LLM provider override (defaults to env-configured: mock by default). */
  provider?: LLMProvider;
  /** Load an existing save file instead of generating a new world. */
  loadSaveFile?: string;
}

/** Narrative wrapper for rejection/clarification turns (no state change). */
function pureNarrative(text: string): TurnResult {
  return {
    narrative: text,
    logEntries: [],
    descriptorUpdates: [],
    fellBackToTalk: false,
  };
}

export class Engine {
  readonly definition: WorldDefinition;
  private state: WorldState;
  private provider: LLMProvider;

  private constructor(
    definition: WorldDefinition,
    state: WorldState,
    provider: LLMProvider,
  ) {
    this.definition = definition;
    this.state = state;
    this.provider = provider;
  }

  /** Current immutable world state (read-only view for callers). */
  get worldState(): WorldState {
    return this.state;
  }

  /**
   * Creates a session: loads the script, generates the world (or loads a
   * save), and wires the LLM provider.
   */
  static create(options: EngineOptions): Engine {
    const definition = loadScript(options.scriptDir);
    const provider = options.provider ?? createProvider();
    let state: WorldState;
    if (options.loadSaveFile) {
      const save = readSave(options.loadSaveFile, definition.script.id);
      state = save.worldState;
    } else {
      const generated = generateWorld(definition, options.originId, {
        seed: options.seed,
      });
      state = generated.state;
      if (options.playerName) {
        state = { ...state, player: { ...state.player, name: options.playerName } };
      }
    }
    return new Engine(definition, state, provider);
  }

  /**
   * Runs one full player turn: free text in, TurnResult out. This is the
   * PDVA pipeline — the LLM proposes (intent + narrative), the engine
   * validates and resolves everything.
   */
  async playerTurn(input: string): Promise<TurnResult> {
    // 1. Intent parsing (LLM or deterministic fallback; cheat gate first).
    const parsed = await parseIntent(this.provider, this.definition, this.state, input);
    switch (parsed.tier) {
      case "reject": {
        const reason = parsed.reason === "teleport" ? "此地没有这样的捷径。" :
          parsed.reason === "cheat" ? "世界法则不会因一句话而改变。" :
          parsed.reason === "matter_creation" ? "万物不会凭空出现。" :
          "这件事在这个世界里做不到。";
        return pureNarrative(reason);
      }
      case "clarify":
        return pureNarrative(parsed.question);
      case "fallback_talk":
        break; // degrade to talk below
      case "direct":
        break;
    }

    // 2. Resolve the action (legality + resolution + costs/effects/time).
    const intent = parsed.tier === "direct" || parsed.tier === "fallback_talk" ? parsed.intent : { actionId: "talk" };
    const resolution = resolveAction({
      definition: this.definition,
      state: this.state,
      actionId: intent.actionId,
      targetNpcId: intent.target && this.definition.npcs.has(intent.target) ? intent.target : undefined,
      params: intent.target ? { target: intent.target } : undefined,
    });
    let state = resolution.state;
    if (resolution.rejected && resolution.rejectReason === "unknown_action") {
      // Unknown action degrades to talk (Bartle tolerance).
      const talk = resolveAction({
        definition: this.definition,
        state: this.state,
        actionId: "talk",
      });
      state = talk.state;
      resolution.rejected = false;
    }
    if (resolution.rejected) {
      // Narrativized refusal (I7): machine reason -> world-consistent text.
      return pureNarrative(this.narrativizeRejection(resolution.rejectReason ?? "", resolution.rejectMessage ?? ""));
    }

    // 3. Commitment check + director event selection.
    const commitmentResult = checkCommitments(state, this.definition);
    state = commitmentResult.state;
    if (directorShouldSelect(state, this.definition)) {
      const directorResult = selectDirectorEvent(state, this.definition);
      state = directorResult.state;
    }

    // 4. Death policy check (soft_failure gauge etc.).
    const deathResult = applyDeathPolicy(state, this.definition);
    if (deathResult.firedMode) {
      state = deathResult.state;
    }

    // 5. Narrative generation (dual-channel) with consistency retry.
    const narrativeCtx = {
      provider: this.provider,
      definition: this.definition,
      state,
      playerInput: input,
      resolution: resolution.resolution,
      npcId: intent.target && this.definition.npcs.has(intent.target) ? intent.target : undefined,
    };
    const consistency = await withConsistencyRetry(
      () => generateNarrative(narrativeCtx),
      this.definition,
      state,
      2,
    );
    let narrativeText: string;
    let mechanicsTags: NarrativeOutput["mechanics_tags"] = [];
    if (consistency.ok && consistency.output) {
      narrativeText = consistency.output.narrative;
      mechanicsTags = consistency.output.mechanics_tags;
    } else {
      narrativeText = fallbackNarrative(this.definition, state, resolution.resolution).narrative;
    }

    // 6. Apply validated mechanics tags (PermOK already checked).
    if (mechanicsTags.length > 0) {
      const effects = tagsToEffects(mechanicsTags);
      const day = absoluteDay(this.definition, state.clock);
      const out = applyEffects(state, effects, { definition: this.definition, day });
      state = out.state;
    }

    // 7. Descriptor refresh (lazy, stale only).
    const { state: refreshed, updates } = await refreshAllStale(state, {
      definition: this.definition,
    });
    state = refreshed;

    this.state = state;

    // 8. Assemble the turn result.
    const newLogs = state.eventLog.slice(-(resolution.logEntries.length + commitmentResult.logEntries.length + 1));
    return {
      narrative: narrativeText,
      resolution: resolution.resolution,
      logEntries: newLogs,
      descriptorUpdates: updates,
      fellBackToTalk: parsed.tier === "fallback_talk" || (resolution.rejected && resolution.rejectReason === "unknown_action"),
      deathFired: deathResult.firedMode,
    };
  }

  /**
   * Deterministic offline advancement: applies needs decay + status ticks
   * + clock advance for `hours` (respects advance_scope via definition).
   */
  advance(hours: number): WorldState {
    if (hours <= 0) return this.state;
    let state = this.state;
    state = { ...state, clock: advanceClock(state.clock, this.definition, hours) };
    // Needs decay (schedules/needs in advance_scope).
    const scope = this.definition.time.advance_scope;
    if (scope.includes("needs")) {
      state = applyNeedDecay(state, this.definition, hours);
    }
    // Status effect ticks.
    state = tickStatuses(state, this.definition);
    this.state = state;
    return state;
  }

  /** Saves the current world state to disk; returns the file path. */
  save(runId?: string): string {
    return writeSave(this.definition, this.state, runId);
  }

  /** Lists existing save files for this script. */
  saves(): string[] {
    return listSaves(this.definition.script.id);
  }

  /** Reloads state from a save file. */
  load(filePath: string): WorldState {
    const save = readSave(filePath, this.definition.script.id);
    this.state = save.worldState;
    return this.state;
  }

  /** User edit to the explanation layer (never touches numeric values). */
  setDescriptor(path: DescriptorPath, text: string): WorldState {
    const out = setUserDescriptor(this.state, path, text);
    this.state = out.state;
    return this.state;
  }

  /** Returns the opening narrative for a fresh world. */
  openingNarrative(): string {
    const opening = this.definition.narrative.opening;
    return `${opening.scene}\n${opening.first_lines.join("\n")}`;
  }

  /** Narrativizes a machine rejection reason into world-consistent text. */
  private narrativizeRejection(reason: string, message: string): string {
    switch (reason) {
      case "npc_absent":
        return "这里没有你要找的人。";
      case "condition_not_met":
        return message || "现在的状况不允许这么做。";
      case "unaffordable":
        return "你付不起这个代价。";
      case "unknown_action":
        return "这个世界没有这样的行动。";
      default:
        return message || "这行不通。";
    }
  }
}

export { buildTurnPrompt };
