import { readFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function readJson(file: string): JsonRecord {
  const value: unknown = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return value as JsonRecord;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const offline = readJson("test/fixtures/action-compilation/offline-report.json");
const offlineExperiment = record(offline.offlineExperiment, "offlineExperiment");
const offlineSelection = record(offlineExperiment.selection, "offlineExperiment.selection");
const offlineGates = record(offlineExperiment.gates, "offlineExperiment.gates");
const offlineC3 = record(offlineGates.C3, "offlineExperiment.gates.C3");
assertEqual(offlineSelection.projectedWinner, "C3", "offline winner");
assertEqual(offlineC3.passesOffline, true, "offline C3 gate");

const live = readJson("test/fixtures/action-compilation/live-report.json");
const liveCorrectness = record(live.correctnessGates, "live.correctnessGates");
const liveExperiment = record(live.experimentGates, "live.experimentGates");
assertEqual(live.selected, "C3", "live winner");
for (const [name, value] of Object.entries({ ...liveCorrectness, ...liveExperiment })) {
  assertEqual(value, true, `live gate ${name}`);
}

process.stdout.write("Action Compilation experiment reports verified: production projector C3 is the sole runtime selection.\n");
