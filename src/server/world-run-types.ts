import type { CommittedStep, ObservationPacket, SimulationState } from "../engine/model";
import type { WorldRuntimeContract } from "../engine/world-definition";
import type {
  PublicObservationPacket,
  PublicSessionDetail,
  PublicSessionState,
  PublicSessionSummary,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
} from "../shared/world-api";
import { isWorldRunExecuting } from "../shared/world-api";
export type {
  PublicObservationPacket,
  PublicSessionDetail,
  PublicSessionState,
  PublicSessionSummary,
  WorldRunEvent,
  WorldRunStatus,
} from "../shared/world-api";

export type WorldRunEventInput = WorldRunEvent extends infer Event
  ? Event extends WorldRunEvent
    ? Omit<Event, "sequence" | "at">
    : never
  : never;

export interface WorldRunRecord extends Omit<WorldRunRecordView, "error" | "inputs"> {
  intentId: string;
  error?: string;
  internalError?: string;
}

export interface WorldSessionDocument {
  schemaVersion: 9;
  id: string;
  world: WorldRuntimeContract;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export function publicSessionState(document: WorldSessionDocument): PublicSessionState {
  return {
    id: document.id,
    worldId: document.world.id,
    worldHash: document.world.contentHash,
    worldVersion: document.world.manifestVersion,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    player: structuredClone(document.state.player.knowledge),
    activeIntent: structuredClone(document.state.player.intent),
  };
}

export function toPublicObservationPacket(
  packet: ObservationPacket,
  packetIndex: number,
): PublicObservationPacket {
  return {
    id: `observation:${packet.step}:${packetIndex + 1}`,
    observerId: "player",
    step: packet.step,
    summary: packet.summary,
    introductions: packet.introductions.map((introduction) => ({
      localEntity: structuredClone(introduction.localEntity),
    })),
    apparentClaims: packet.apparentClaims.map((claim, claimIndex) => ({
      ...structuredClone(claim),
      id: `claim:${packet.step}:${packetIndex + 1}:${claimIndex + 1}`,
    })),
    sourceEventIds: packet.sourceEventIds.map((_eventId, eventIndex) =>
      `event:${packet.step}:${packetIndex + 1}:${eventIndex + 1}`),
  };
}

export function publicCommittedStepEvents(
  committed: CommittedStep,
  elapsedSeconds: number,
): WorldRunEventInput[] {
  const playerAction = committed.actions.find((action) => action.actorId === "player");
  if (!playerAction) throw new Error(`committed step ${committed.step} has no player action`);
  const playerOutcome = committed.outcomes.find((outcome) => outcome.proposalId === playerAction.id);
  if (!playerOutcome) throw new Error(`committed step ${committed.step} has no player outcome`);
  const outcomeSummaries = committed.observations
    .filter((packet) => packet.observerId === "player" && packet.kind === "outcome")
    .map((packet) => packet.summary.trim());
  if (outcomeSummaries.length === 0 || outcomeSummaries.some((summary) => !summary)) {
    throw new Error(`committed step ${committed.step} has no public player outcome`);
  }
  const events: WorldRunEventInput[] = [];
  for (const [checkIndex, check] of committed.checks.entries()) {
    if (check.visibility === "hidden") continue;
    events.push({
      type: "check.resolved",
      payload: check.visibility === "full"
        ? {
            requestId: `check:${committed.step}:${checkIndex + 1}`,
            visibility: "full",
            dice: check.dice,
            kept: check.kept,
            modifier: check.modifier,
            total: check.total,
            dc: check.dc,
            succeeded: check.succeeded,
            margin: check.margin,
          }
        : {
            requestId: `check:${committed.step}:${checkIndex + 1}`,
            visibility: "result_only",
            succeeded: check.succeeded,
          },
    });
  }
  events.push({
    type: "player.outcome",
    payload: {
      status: playerOutcome.status,
      summary: outcomeSummaries.join("\n"),
    },
  });
  const playerPackets = committed.observations.filter((packet) => packet.observerId === "player");
  for (const [packetIndex, packet] of playerPackets.entries()) {
    events.push({ type: "player.observation", payload: toPublicObservationPacket(packet, packetIndex) });
  }
  events.push({
    type: "step.committed",
    payload: { revision: committed.revision, step: committed.step, elapsedSeconds },
  });
  return events;
}

function publicWorldSummary(document: WorldSessionDocument) {
  return {
    id: document.world.id,
    name: document.world.name,
    version: document.world.manifestVersion,
    contentHash: document.world.contentHash,
    description: document.world.description,
  };
}

export function publicSessionSummary(document: WorldSessionDocument): PublicSessionSummary {
  const activeRun = Object.values(document.runs).find((run) => isWorldRunExecuting(run.status));
  return {
    id: document.id,
    worldId: document.world.id,
    title: document.title,
    world: publicWorldSummary(document),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    activeRun: activeRun && isWorldRunExecuting(activeRun.status)
      ? { id: activeRun.id, status: activeRun.status }
      : undefined,
  };
}

export function publicWorldRunRecord(run: WorldRunRecord): WorldRunRecordView {
  return {
    id: run.id,
    sessionId: run.sessionId,
    inputs: run.events.flatMap((event) => event.type === "player.input"
      ? [{ ...event.payload, at: event.at }]
      : []),
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    cancelRequested: run.cancelRequested,
    error: run.error,
    events: structuredClone(run.events),
  };
}

export function publicWorldRunSnapshot(
  document: WorldSessionDocument,
  run: WorldRunRecord,
): WorldRunSnapshot {
  return {
    run: publicWorldRunRecord(run),
    state: publicSessionState(document),
  };
}

export function publicSessionDetail(document: WorldSessionDocument): PublicSessionDetail {
  return {
    summary: publicSessionSummary(document),
    state: publicSessionState(document),
    runs: Object.values(document.runs)
      .map(publicWorldRunRecord)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
  };
}
