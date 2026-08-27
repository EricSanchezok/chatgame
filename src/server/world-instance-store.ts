import type { PolicyBinding } from "../engine/execution";
import { contentHash } from "../engine/model-audit";
import type { RuntimeCorrelation } from "../engine/observability";
import { validateSimulationState } from "../engine/transaction";
import type { StoredWorldInstance, WorldInstanceDocument } from "./world-instance-types";

export class WorldInstanceNotFoundError extends Error {
  readonly status = 404;
  constructor(id: string) {
    super(`world instance ${id} not found`);
    this.name = "WorldInstanceNotFoundError";
  }
}

export class WorldInstanceConflictError extends Error {
  readonly status = 409;
  constructor(id: string) {
    super(`world instance ${id} changed concurrently`);
    this.name = "WorldInstanceConflictError";
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function validateExternalAction(
  action: WorldInstanceDocument["advances"][string]["request"]["externalActions"][number],
  label: string,
): void {
  if (!action || typeof action !== "object") throw new Error(`${label} must be an object`);
  requireText(action.submissionId, `${label} submission id`);
  requireText(action.agentId, `${label} agent id`);
  requireText(action.rawText, `${label} text`);
  requireText(action.goal, `${label} goal`);
  if (action.means !== null) requireText(action.means, `${label} means`);
  if (!Array.isArray(action.targetIds) || action.targetIds.some((targetId) => typeof targetId !== "string" || !targetId.trim())) {
    throw new Error(`${label} target ids must be non-empty strings`);
  }
  if (new Set(action.targetIds).size !== action.targetIds.length) {
    throw new Error(`${label} contains duplicate target ids`);
  }
}

function validateBinding(agentId: string, binding: PolicyBinding, document: WorldInstanceDocument): void {
  if (!binding || typeof binding !== "object") throw new Error(`policy binding ${agentId} must be an object`);
  if (binding.agentId !== agentId) throw new Error(`policy binding key mismatch for ${agentId}`);
  if (!(agentId in document.state.agents)) throw new Error(`policy binding references unknown agent ${agentId}`);
  switch (binding.kind) {
    case "model": {
      requireText(binding.profiles.bootstrap, `model policy ${agentId} bootstrap profile`);
      requireText(binding.profiles.mind, `model policy ${agentId} mind profile`);
      requireText(binding.profiles.reaction, `model policy ${agentId} reaction profile`);
      if (binding.resumeFromRevision !== undefined &&
        (!Number.isSafeInteger(binding.resumeFromRevision) || binding.resumeFromRevision < 0 ||
          binding.resumeFromRevision > document.state.revision)) {
        throw new Error(`model policy ${agentId} has an invalid resume revision`);
      }
      break;
    }
    case "external": {
      requireText(binding.participantId, `external policy ${agentId} participant id`);
      const participant = document.participants[binding.participantId];
      if (!participant || participant.status !== "active" || participant.agentId !== agentId) {
        throw new Error(`external policy ${agentId} has no active participant`);
      }
      break;
    }
    case "idle":
      if (!["timeout", "released", "explicit"].includes(binding.reason)) {
        throw new Error(`idle policy ${agentId} has an invalid reason`);
      }
      break;
    case "replay":
      requireText(binding.sourceExecutionId, `replay policy ${agentId} source execution id`);
      break;
    default:
      throw new Error(`policy binding ${agentId} has an unknown kind`);
  }
}

function validateParticipant(
  participantId: string,
  participant: WorldInstanceDocument["participants"][string],
  document: WorldInstanceDocument,
): void {
  if (!participant || typeof participant !== "object") throw new Error(`participant ${participantId} must be an object`);
  if (participant.id !== participantId) throw new Error(`participant key mismatch for ${participantId}`);
  requireText(participant.principalId, `participant ${participantId} principal`);
  requireText(participant.displayName, `participant ${participantId} display name`);
  requireText(participant.agentId, `participant ${participantId} agent id`);
  if (!(participant.agentId in document.state.agents)) throw new Error(`participant ${participantId} references unknown agent`);
  if (participant.status !== "active" && participant.status !== "released") {
    throw new Error(`participant ${participantId} has an invalid status`);
  }
  if (!Number.isFinite(Date.parse(participant.joinedAt)) || !Number.isFinite(Date.parse(participant.updatedAt))) {
    throw new Error(`participant ${participantId} timestamps must be ISO dates`);
  }
  if (!Number.isSafeInteger(participant.controlledSinceRevision) || participant.controlledSinceRevision < 0 ||
    participant.controlledSinceRevision > document.state.revision) {
    throw new Error(`participant ${participantId} has an invalid control revision`);
  }
  if (participant.admissionExecutionId !== undefined) {
    requireText(participant.admissionExecutionId, `participant ${participantId} admission execution id`);
  }
  if (participant.suppressedActionId !== undefined) {
    requireText(participant.suppressedActionId, `participant ${participantId} suppressed action id`);
  }
  const arrival = participant.arrival;
  if (!arrival || typeof arrival !== "object") throw new Error(`participant ${participantId} arrival is required`);
  requireText(arrival.id, `participant ${participantId} arrival id`);
  requireText(arrival.title, `participant ${participantId} arrival title`);
  requireText(arrival.scene, `participant ${participantId} arrival scene`);
  if (!Number.isSafeInteger(arrival.revision) || arrival.revision < 0 || arrival.revision > document.state.revision) {
    throw new Error(`participant ${participantId} arrival revision is invalid`);
  }
  if (!Number.isSafeInteger(arrival.step) || arrival.step < 0 || arrival.step > document.state.step) {
    throw new Error(`participant ${participantId} arrival step is invalid`);
  }
  if (!Array.isArray(arrival.suggestions) || arrival.suggestions.length !== 3 ||
    arrival.suggestions.some((suggestion) => typeof suggestion !== "string" || !suggestion.trim())) {
    throw new Error(`participant ${participantId} arrival suggestions are invalid`);
  }
  if (typeof arrival.generated !== "boolean" || !Number.isFinite(Date.parse(arrival.createdAt))) {
    throw new Error(`participant ${participantId} arrival metadata is invalid`);
  }
  if (arrival.executionId !== undefined) {
    requireText(arrival.executionId, `participant ${participantId} arrival execution id`);
  }
}

function validateActionWindow(document: WorldInstanceDocument): void {
  const window = document.actionWindow;
  if (!window) return;
  requireText(window.id, "action window id");
  if (!Number.isSafeInteger(window.baseRevision) || window.baseRevision !== document.state.revision) {
    throw new Error("action window must belong to the current revision");
  }
  if (!Number.isSafeInteger(window.generation) || window.generation < 1) {
    throw new Error("action window generation must be positive");
  }
  if (!["open", "resolving", "committed", "cancelled"].includes(window.status)) {
    throw new Error("action window has an invalid status");
  }
  if (window.deadlineAt !== null && !Number.isFinite(Date.parse(window.deadlineAt))) {
    throw new Error("action window deadline must be an ISO date or null");
  }
  if (new Set(window.requiredAgentIds).size !== window.requiredAgentIds.length) {
    throw new Error("action window contains duplicate required Agents");
  }
  for (const agentId of window.requiredAgentIds) {
    const binding = document.policyBindings[agentId];
    if (binding?.kind !== "external") throw new Error(`action window requires non-external Agent ${agentId}`);
  }
  for (const [agentId, action] of Object.entries(window.submissions)) {
    if (!window.requiredAgentIds.includes(agentId) || action.agentId !== agentId) {
      throw new Error(`invalid action window submission for ${agentId}`);
    }
    validateExternalAction(action, `action window submission ${agentId}`);
  }
}

export function validateWorldInstanceDocument(document: WorldInstanceDocument): void {
  if (document.schemaVersion !== 14) throw new Error("world instance schema v14 required");
  requireText(document.id, "instance id");
  requireText(document.title, "instance title");
  if (document.title.length > 80) throw new Error("instance title exceeds 80 characters");
  if (!Number.isFinite(Date.parse(document.createdAt)) || !Number.isFinite(Date.parse(document.updatedAt))) {
    throw new Error("instance timestamps must be ISO dates");
  }
  validateSimulationState(document.state, false, true);
  if (document.state.worldId !== document.world.id || document.state.worldHash !== document.world.contentHash) {
    throw new Error("instance state does not match its pinned world");
  }
  const bindingIds = Object.keys(document.policyBindings).sort();
  const agentIds = Object.keys(document.state.agents).sort();
  if (contentHash(bindingIds) !== contentHash(agentIds)) throw new Error("every agent must have exactly one policy binding");
  for (const [agentId, binding] of Object.entries(document.policyBindings)) validateBinding(agentId, binding, document);
  const controlled = new Set<string>();
  for (const [participantId, participant] of Object.entries(document.participants)) {
    validateParticipant(participantId, participant, document);
    if (participant.status === "active" && controlled.has(participant.agentId)) {
      throw new Error(`agent ${participant.agentId} is controlled by multiple participants`);
    }
    if (participant.status === "active") {
      const binding = document.policyBindings[participant.agentId];
      if (binding?.kind !== "external" || binding.participantId !== participantId) {
        throw new Error(`active participant ${participantId} does not own its external policy`);
      }
      controlled.add(participant.agentId);
    }
  }
  validateActionWindow(document);
  for (const value of Object.values(document.runtime)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("runtime durations must be positive integers");
  }
  if (document.scheduler.mode !== "paused" && document.scheduler.mode !== "realtime") {
    throw new Error("scheduler mode is invalid");
  }
  if (!Number.isSafeInteger(document.scheduler.generation) || document.scheduler.generation < 1) {
    throw new Error("scheduler generation must be positive");
  }
  if (document.scheduler.nextTickAt !== null && !Number.isFinite(Date.parse(document.scheduler.nextTickAt))) {
    throw new Error("scheduler next tick must be an ISO date or null");
  }
  if (document.scheduler.mode === "paused" && document.scheduler.nextTickAt !== null) {
    throw new Error("paused scheduler cannot have a next tick");
  }
  for (const [advanceId, advance] of Object.entries(document.advances)) {
    if (advance.id !== advanceId) throw new Error(`advance key mismatch for ${advanceId}`);
    if (!["awaiting_actions", "queued", "running", "committed", "cancelled", "failed"].includes(advance.status)) {
      throw new Error(`advance ${advanceId} has an invalid status`);
    }
    if (!Number.isFinite(Date.parse(advance.createdAt)) || !Number.isFinite(Date.parse(advance.updatedAt))) {
      throw new Error(`advance ${advanceId} timestamps must be ISO dates`);
    }
    if (!Number.isSafeInteger(advance.request.expectedRevision) || advance.request.expectedRevision < 0) {
      throw new Error(`advance ${advanceId} has an invalid request`);
    }
    if (!["manual", "batch", "realtime", "participant_action"].includes(advance.request.trigger)) {
      throw new Error(`advance ${advanceId} has an invalid trigger`);
    }
    if (!Array.isArray(advance.request.externalActions)) {
      throw new Error(`advance ${advanceId} external actions must be an array`);
    }
    const submittedAgents = new Set<string>();
    const submissionIds = new Set<string>();
    for (const action of advance.request.externalActions) {
      validateExternalAction(action, `advance ${advanceId} external action`);
      if (!(action.agentId in document.state.agents)) {
        throw new Error(`advance ${advanceId} action references unknown Agent ${action.agentId}`);
      }
      if (submittedAgents.has(action.agentId) || submissionIds.has(action.submissionId)) {
        throw new Error(`advance ${advanceId} contains duplicate external actions`);
      }
      submittedAgents.add(action.agentId);
      submissionIds.add(action.submissionId);
    }
    if (!Array.isArray(advance.executionIds) || advance.executionIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error(`advance ${advanceId} execution ids must be non-empty strings`);
    }
    if (!Array.isArray(advance.committedRevisions) || advance.committedRevisions.some((revision) =>
      !Number.isSafeInteger(revision) || revision < 0 || revision > document.state.revision)) {
      throw new Error(`advance ${advanceId} committed revisions are invalid`);
    }
    if (advance.error !== undefined) requireText(advance.error, `advance ${advanceId} error`);
  }
  for (const intent of document.participantIntents) {
    requireText(intent.participantId, "participant intent participant id");
    requireText(intent.agentId, "participant intent agent id");
    requireText(intent.advanceId, "participant intent advance id");
    requireText(intent.submissionId, "participant intent submission id");
    requireText(intent.text, "participant intent text");
    if (!(intent.participantId in document.participants)) {
      throw new Error(`participant intent references unknown participant ${intent.participantId}`);
    }
    if (!(intent.agentId in document.state.agents) || !(intent.advanceId in document.advances)) {
      throw new Error(`participant intent ${intent.submissionId} references unknown execution state`);
    }
    if (!Number.isSafeInteger(intent.revision) || intent.revision < 0 || intent.revision > document.state.revision) {
      throw new Error(`participant intent ${intent.submissionId} has an invalid revision`);
    }
    if (!Number.isFinite(Date.parse(intent.submittedAt))) {
      throw new Error(`participant intent ${intent.submissionId} timestamp must be an ISO date`);
    }
  }
}

export function serializeWorldInstanceDocument(document: WorldInstanceDocument): string {
  validateWorldInstanceDocument(document);
  return JSON.stringify(document);
}

export function parseWorldInstanceDocument(serialized: string, expectedId: string): WorldInstanceDocument {
  const value = JSON.parse(serialized) as WorldInstanceDocument;
  validateWorldInstanceDocument(value);
  if (value.id !== expectedId) throw new Error("world instance id mismatch");
  return value;
}

export interface WorldInstanceStore {
  createInstance(document: WorldInstanceDocument, correlation?: RuntimeCorrelation): StoredWorldInstance;
  readInstance(id: string, correlation?: RuntimeCorrelation): StoredWorldInstance;
  compareAndSwapInstance(
    id: string,
    expectedGeneration: number,
    document: WorldInstanceDocument,
    correlation?: RuntimeCorrelation,
  ): StoredWorldInstance;
  listInstances(correlation?: RuntimeCorrelation): StoredWorldInstance[];
  deleteInstance(id: string, expectedGeneration: number, correlation?: RuntimeCorrelation): void;
}
