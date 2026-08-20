// Engine facade: the single public entry point for the runtime.
//   createSession() -> load script + generate world (+ opening event)
//   playerTurn(input) -> full PDVA turn loop (intent -> legality ->
//     resolution -> world step -> commitment/director -> tasks -> death ->
//     narrative -> consistency -> descriptor refresh)
//   advance(hours) -> deterministic offline world progression
//   save() / loadSave() -> JSON snapshots
import type { WorldDefinition, WorldState, SessionOptions, TurnResult, MediaCue, EventLogEntry } from "./types";
import type { ActionPreview, TurnInput } from "../shared/client-dto";
import type { DescriptorPath } from "./descriptors";
import { loadScript } from "./loader";
import { generateWorld } from "./worldgen";
import { previewAction, resolveAction } from "./actions";
import { selectDirectorEvent, directorShouldSelect } from "./director";
import { applyEffects } from "./effect";
import { refreshAllStale, setUserDescriptor, llmDescriptorGenerator } from "./descriptors";
import { writeSave, readSave, listSaves, normalizeWorldState } from "./save";
import { fsSaveStore, type SaveStore } from "./save-store";
import { applyDeathPolicy, applyUnlocks, metaProgressionSnapshot } from "./run";
import { stepWorld } from "./worldstep";
import { playEvent, eventTextFor } from "./events";
import { checkTasks } from "./tasks";
import { checkCommitments } from "./plot";
import { absoluteDay } from "./time";
import { evalCondition } from "./condition";
import { createProvider, type LLMProvider } from "./narrative/provider";
import { parseIntent } from "./narrative/intent";
import { generateNarrative, fallbackNarrative, type NarrativeOutput } from "./narrative/narrative";
import { withConsistencyRetry, tagsToEffects } from "./narrative/consistency";
import { memorySelections, buildTurnPrompt } from "./narrative/prompt";
import { recordMemoryAccess } from "./memory";
import { buildContextBlocks, shouldSummarize, summarizeContext } from "./context";
import { appendTranscript, deriveMediaCues } from "./presentation";
import { runLifecycle } from "./extensions";

export interface EngineOptions extends SessionOptions {
  /** LLM provider override (defaults to env-configured: mock by default). */
  provider?: LLMProvider;
  /** Load an existing save file instead of generating a new world. */
  loadSaveFile?: string;
  /** Save backend (defaults to the repo-local fs store). */
  saveStore?: SaveStore;
}
/** Narrative wrapper for rejection/clarification turns (no state change). */
function pureNarrative(text: string): TurnResult {
  return {
    narrative: text,
    logEntries: [],
    descriptorUpdates: [],
    fellBackToTalk: false,
    worldEvents: [],
    taskCompletions: [],
    mediaCues: [],
  };
}

export class Engine {
  readonly definition: WorldDefinition;
  private state: WorldState;
  private provider: LLMProvider;
  private saveStore: SaveStore;

  private constructor(
    definition: WorldDefinition,
    state: WorldState,
    provider: LLMProvider,
    saveStore: SaveStore,
  ) {
    this.definition = definition;
    this.state = state;
    this.provider = provider;
    this.saveStore = saveStore;
  }
  /** Current immutable world state (read-only view for callers). */
  get worldState(): WorldState {
    return this.state;
  }

  /**
   * Creates a session: loads the script, generates the world (or loads a
   * save), normalizes the state, plays the opening event, and wires the
   * LLM provider.
   */
  static create(options: EngineOptions): Engine {
    const definition = loadScript(options.scriptDir);
    const provider = options.provider ?? createProvider();
    let state: WorldState;
    if (options.loadSaveFile) {
      const save = readSave(options.loadSaveFile, definition.script.id, options.saveStore ?? fsSaveStore);
      state = normalizeWorldState(definition, save.worldState);
    } else {
      const generated = generateWorld(definition, options.originId, {
        seed: options.seed,
      });
      state = normalizeWorldState(definition, generated.state);
      if (options.playerName) {
        state = { ...state, player: { ...state.player, name: options.playerName } };
      }
    }
    const sessionStart = runLifecycle("sessionStart", state, { definition });
    state = sessionStart.state;
    for (const summary of sessionStart.summaries) {
      const log: EventLogEntry = {
        id: `log-${state.eventLog.length + 1}`,
        day: absoluteDay(definition, state.clock),
        hour: state.clock.hour,
        type: "system",
        actor: "extension",
        summary,
      };
      state = { ...state, eventLog: [...state.eventLog, log] };
    }
    const engine = new Engine(definition, state, provider, options.saveStore ?? fsSaveStore);
    // Fresh session: play the worldgen starting event and seed the opening
    // transcript entry (the UI renders history from the transcript).
    if (!options.loadSaveFile) {
      const startingEventId = engine.startingEventId();
      if (startingEventId) {
        const out = playEvent(engine.state, definition, startingEventId);
        engine.state = out.state;
      }
      const cues: MediaCue[] = startingEventId
        ? [{ kind: "event", eventId: startingEventId }]
        : [];
      engine.state = appendTranscript(engine.state, "world", engine.openingNarrative(), cues);
    }
    return engine;
  }

  /** The worldgen starting event id (undefined when not randomized). */
  private startingEventId(): string | undefined {
    return this.definition.worldgen.randomize.find((r) => r.target === "starting_event")
      ? this.state.playedEventIds[this.state.playedEventIds.length - 1]
      : undefined;
  }

  /**
   * Runs one full player turn: free text in, TurnResult out. This is the
   * PDVA pipeline — the LLM proposes (intent + narrative), the engine
   * validates and resolves everything.
   */
  async playerTurn(turnInput: TurnInput): Promise<TurnResult> {
    const input = turnInput.text;
    // 1. Intent parsing (LLM or deterministic fallback; cheat gate first).
    const parsed = turnInput.intentHint
      ? { tier: "direct" as const, intent: { actionId: turnInput.intentHint.actionId, target: turnInput.intentHint.target } }
      : await parseIntent(this.provider, this.definition, this.state, input);
    switch (parsed.tier) {
      case "reject": {
        const reason = parsed.reason === "teleport" ? "此地没有这样的捷径。" :
          parsed.reason === "cheat" ? "世界法则不会因一句话而改变。" :
          parsed.reason === "matter_creation" ? "万物不会凭空出现。" :
          "这件事在这个世界里做不到。";
        this.state = appendTranscript(this.state, "player", input, []);
        this.state = appendTranscript(this.state, "world", reason, []);
        return pureNarrative(reason);
      }
      case "clarify": {
        this.state = appendTranscript(this.state, "player", input, []);
        this.state = appendTranscript(this.state, "world", parsed.question, []);
        return pureNarrative(parsed.question);
      }
      case "fallback_talk":
        break; // degrade to talk below
      case "direct":
        break;
    }

    // 2. Resolve the action (legality + resolution + costs/effects).
    const intent = parsed.tier === "direct" || parsed.tier === "fallback_talk" ? parsed.intent : { actionId: "talk" };
    const resolution = resolveAction({
      definition: this.definition,
      state: this.state,
      actionId: intent.actionId,
      targetNpcId: intent.target && this.definition.npcs.has(intent.target) ? intent.target : undefined,
      params: {
        ...(turnInput.intentHint?.params ?? {}),
        ...(intent.target ? { target: intent.target } : {}),
      },
    });
    const turnStartState = this.state;
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
      const text = this.narrativizeRejection(resolution.rejectReason ?? "", resolution.rejectMessage ?? "");
      this.state = appendTranscript(this.state, "player", input, []);
      this.state = appendTranscript(this.state, "world", text, []);
      return pureNarrative(text);
    }

    // 3. World step: advance the clock by the action's time cost and run
    //    the unified progression pipeline (needs/status/schedules/events/
    //    commitments/tension) for that span.
    const step = stepWorld(state, this.definition, resolution.effectiveTimeCost);
    state = step.state;

    const turnLifecycle = runLifecycle("turnResolved", state, {
      definition: this.definition,
      previousState: turnStartState,
      turnInput,
      resolution: resolution.resolution,
    });
    state = turnLifecycle.state;
    const lifecycleLogs: EventLogEntry[] = [];
    for (const summary of turnLifecycle.summaries) {
      const log: EventLogEntry = {
        id: `log-${state.eventLog.length + 1}`,
        day: absoluteDay(this.definition, state.clock),
        hour: state.clock.hour,
        type: "system",
        actor: "extension",
        summary,
      };
      state = { ...state, eventLog: [...state.eventLog, log] };
      lifecycleLogs.push(log);
    }

    // 3b. Turn-level commitment check: condition triggers fire as soon as
    //     their condition holds mid-day (the day-boundary check inside
    //     stepWorld stays idempotent via the `triggered` flag).
    const commitmentOut = checkCommitments(state, this.definition);
    state = commitmentOut.state;
    const commitmentTexts = commitmentOut.eventTexts;

    // 4. Director event selection (pacing-gated) — play immediately.
    const directorEventTexts: string[] = [];
    if (directorShouldSelect(state, this.definition)) {
      const directorResult = selectDirectorEvent(state, this.definition);
      state = directorResult.state;
      if (directorResult.selectedEventId) {
        const played = playEvent(state, this.definition, directorResult.selectedEventId);
        state = played.state;
        if (played.played && played.text) directorEventTexts.push(played.text);
      }
    }

    // 5. Task checks (auto-activate + progress + completions/failures).
    const taskOut = checkTasks(state, this.definition);
    state = taskOut.state;
    const taskCompletions = taskOut.completions.map((c) => ({
      taskId: c.taskId,
      status: c.status,
      narrative: c.narrative,
    }));

    // 6. Death policy check (soft_failure gauge / hp 归零).
    const deathResult = applyDeathPolicy(state, this.definition);
    if (deathResult.firedMode) {
      state = deathResult.state;
      if (deathResult.narrative) {
        // The consequence is engine-owned fact: surface it in the chat
        // history as a system entry (visible even after a world reroll).
        state = appendTranscript(state, "system", deathResult.narrative, []);
      }
    }

    // 7. Narrative generation (dual-channel) with consistency retry.
    const worldEvents = [
      ...step.worldEvents,
      ...commitmentTexts,
      ...directorEventTexts,
    ];

    const npcId = intent.target && this.definition.npcs.has(intent.target) ? intent.target : undefined;
    // Memory selections computed before narrative generation so the exact
    // injected ids can be reinforced afterwards (deterministic: same state +
    // same input -> same selection, and LLM tags cannot write memory — I3).
    const memSel = memorySelections({
      definition: this.definition,
      state,
      playerInput: input,
      npcId,
    });
    const injectedMemoryIds = [
      ...memSel.player.ids,
      ...(memSel.npc ? memSel.npc.ids : []),
    ];
    // Context assembly: layers B (state snapshot) + C (rolling summary) +
    // D (recent transcript verbatim) — the "LLM 失忆" fix. The player's
    // current input is appended last inside buildTurnPrompt (recency bias).
    const contextBlocks = buildContextBlocks(state, this.definition);
    const narrativeCtx = {
      provider: this.provider,
      definition: this.definition,
      state,
      playerInput: input,
      resolution: resolution.resolution,
      npcId,
      contextBlocks,
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
      // Access reinforcement: only when the full prompt (with memory
      // injection) actually generated the narrative — fallback paths that
      // never injected must not reinforce (conservative, deterministic).
      state = recordMemoryAccess(state, this.definition, injectedMemoryIds);
    } else {
      narrativeText = fallbackNarrative(this.definition, state, resolution.resolution).narrative;
    }
    // Append world event texts to the narrative (engine-owned facts).
    if (worldEvents.length > 0) {
      narrativeText = `${narrativeText}\n\n${worldEvents.join("\n")}`;
    }

    // 8. Apply validated mechanics tags (PermOK already checked).
    if (mechanicsTags.length > 0) {
      const effects = tagsToEffects(mechanicsTags);
      const day = absoluteDay(this.definition, state.clock);
      const out = applyEffects(state, effects, { definition: this.definition, day });
      state = out.state;
    }

    // 9. Descriptor refresh (lazy, stale only; LLM generator with
    //    deterministic template fallback on failure).
    const { state: refreshed, updates } = await refreshAllStale(state, {
      definition: this.definition,
      generator: llmDescriptorGenerator(this.provider),
      recentEvents: step.worldEvents,
    });
    state = refreshed;
    this.state = state;

    // 10. Media cues + transcript append + turn result assembly.
    const mediaCues = deriveMediaCues(turnStartState, state, resolution.resolution);
    state = appendTranscript(state, "player", input, []);
    state = appendTranscript(state, "world", narrativeText, mediaCues);
    // 10b. Context compaction: produce/continue the rolling summary when
    //      triggered (turn-count fallback or budget overflow). A failure
    //      degrades to the pure window — the turn is never blocked.
    if (shouldSummarize(state, this.definition)) {
      const summary = await summarizeContext(this.provider, this.definition, state);
      if (summary) state = { ...state, contextSummary: summary };
    }
    this.state = state;
    const newLogs = state.eventLog.slice(-(resolution.logEntries.length + step.logEntries.length + lifecycleLogs.length + taskOut.logEntries.length + 1));
    return {
      narrative: narrativeText,
      resolution: resolution.resolution,
      logEntries: newLogs,
      descriptorUpdates: updates,
      fellBackToTalk: parsed.tier === "fallback_talk" || (resolution.rejected && resolution.rejectReason === "unknown_action"),
      deathFired: deathResult.firedMode,
      worldEvents,
      taskCompletions,
      mediaCues,
    };
  }

  previewAction(hint: Parameters<typeof previewAction>[2]): ActionPreview {
    return previewAction(this.definition, this.state, hint);
  }

  advance(hours: number): WorldState {
    if (hours <= 0) return this.state;
    if (!this.definition.time.world_advances) return this.state;
    let state = stepWorld(this.state, this.definition, hours, {
      scope: this.definition.time.advance_scope,
    }).state;
    // Offline advancement can push the player into death conditions (hp 归零
    // or soft_failure threshold). The policy must run here too, exactly like
    // playerTurn step 6, so a resumed run is never left in a dead state with
    // an inconsistent transcript.
    const deathResult = applyDeathPolicy(state, this.definition);
    if (deathResult.firedMode) {
      state = deathResult.state;
      if (deathResult.narrative) {
        // Engine-owned fact: surface the consequence in the chat history as
        // a system entry (visible even after a world reroll).
        state = appendTranscript(state, "system", deathResult.narrative, []);
      }
    }
    this.state = state;
    return this.state;
  }

  /** Saves the current world state to disk; returns the file path. */
  save(runId?: string): string {
    return writeSave(this.definition, this.state, runId, this.saveStore);
  }

  /** Lists existing save files for this script. */
  saves(): string[] {
    return listSaves(this.definition.script.id, this.saveStore);
  }

  /** Reloads state from a save file (normalized against the definition). */
  load(filePath: string): WorldState {
    const save = readSave(filePath, this.definition.script.id, this.saveStore);
    this.state = normalizeWorldState(this.definition, save.worldState);
    return this.state;
  }
  setDescriptor(path: DescriptorPath, text: string): WorldState {
    const out = setUserDescriptor(this.state, path, text);
    this.state = out.state;
    return this.state;
  }

  /** Returns the opening narrative for a fresh world. */
  openingNarrative(): string {
    const opening = this.definition.narrative.opening;
    // Pick the first hook whose condition holds (world-consistent opening).
    let hookText = "";
    for (const hook of opening.hooks ?? []) {
      if (!hook.condition) {
        hookText = hook.text;
        break;
      }
      if (evalCondition(hook.condition, { definition: this.definition, state: this.state })) {
        hookText = hook.text;
        break;
      }
    }
    let text = `${opening.scene}\n${opening.first_lines.join("\n")}`;
    if (hookText) text = `${text}\n${hookText}`;
    // Append the starting event's text when one played at creation.
    const startingEvent = this.startingEventId();
    if (startingEvent) {
      const eventText = eventTextFor(this.definition, startingEvent);
      if (eventText) text = `${text}\n\n${eventText}`;
    }
    return text;
  }

  /** Origins unlocked by meta-progression flags (for the meta layer). */
  unlockedOrigins(): string[] {
    return applyUnlocks(this.state, this.definition);
  }

  /** Per-run persisted meta snapshot (flags/lore/relations). */
  metaSnapshot(): { flags: string[]; lore: string[]; relations: WorldState["player"]["relations"] } {
    return metaProgressionSnapshot(this.state, this.definition);
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
      case "on_cooldown":
        return "你刚刚才做过这件事，现在还不是时候——再等等吧。";
      case "denied_action":
        return "你的出身让你做不出这种事。";
      case "unknown_action":
        return "这个世界没有这样的行动。";
      default:
        return message || "这行不通。";
    }
  }
}

export { buildTurnPrompt };
