import { createHash } from "node:crypto";
import { contentHash } from "../models/model-audit";
import {
  validateAlgorithmRef,
  type AlgorithmRef,
  type WorldExecutionAlgorithmRegistry,
} from "./execution";

export interface AlgorithmExperimentManifest {
  schemaVersion: 2;
  id: string;
  version: string;
  layer: "world-execution";
  unit: "instance";
  salt: string;
  eligibility: {
    worldContentHashes: readonly string[];
  };
  variants: readonly {
    id: string;
    allocationBasisPoints: number;
    algorithmRef: AlgorithmRef;
  }[];
  activationEvidence: {
    artifactHash: string;
    verifier: string;
  };
  hash: string;
}

export interface ExperimentEnrollment {
  experimentId: string;
  experimentVersion: string;
  experimentManifestHash: string;
  variantId: string;
  bucket: number;
  assignmentHash: string;
  algorithmRef: AlgorithmRef;
}

export interface ExperimentEnrollmentDecision {
  enrollment: ExperimentEnrollment | null;
  algorithmRef: AlgorithmRef;
  exclusionReason?: "explicit-execution-tuning" | "no-active-experiment" | "world-ineligible" | "experiment-stopped";
  exclusionDetail?: string;
}

export interface ExperimentEnrollmentSafetyStore {
  readExperimentEnrollmentStop(experimentId: string, experimentVersion: string): string | undefined;
  writeExperimentEnrollmentStop(experimentId: string, experimentVersion: string, reason: string): void;
}

export function experimentAssignmentBucket(input: {
  experimentManifestHash: string;
  salt: string;
  instanceId: string;
  assignmentVersion: string;
}): number {
  const separated = [
    "living-world-experiment-assignment-v2",
    input.experimentManifestHash,
    input.salt,
    input.instanceId,
    input.assignmentVersion,
  ].join("\0");
  return Number.parseInt(createHash("sha256").update(separated).digest("hex").slice(0, 8), 16) % 10_000;
}

function requiredText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
}

function body(manifest: Omit<AlgorithmExperimentManifest, "hash">): Omit<AlgorithmExperimentManifest, "hash"> {
  return structuredClone(manifest);
}

export function defineAlgorithmExperimentManifest(
  input: Omit<AlgorithmExperimentManifest, "schemaVersion" | "layer" | "unit" | "hash">,
): AlgorithmExperimentManifest {
  const value = body({ schemaVersion: 2, layer: "world-execution", unit: "instance", ...input });
  const manifest = { ...value, hash: contentHash(value) };
  validateAlgorithmExperimentManifest(manifest);
  return Object.freeze(structuredClone(manifest));
}

export function validateAlgorithmExperimentManifest(manifest: AlgorithmExperimentManifest): void {
  if (!manifest || typeof manifest !== "object") throw new Error("algorithm experiment manifest is required");
  if (manifest.schemaVersion !== 2 || manifest.layer !== "world-execution" || manifest.unit !== "instance") {
    throw new Error("unsupported algorithm experiment manifest contract");
  }
  requiredText(manifest.id, "experiment id");
  requiredText(manifest.version, "experiment version");
  requiredText(manifest.salt, "experiment salt");
  requiredText(manifest.activationEvidence.artifactHash, "experiment activation artifact hash");
  requiredText(manifest.activationEvidence.verifier, "experiment activation verifier");
  if (!Array.isArray(manifest.eligibility.worldContentHashes) || manifest.eligibility.worldContentHashes.some((hash) => typeof hash !== "string" || hash.length === 0)) {
    throw new Error("experiment eligibility world hashes are invalid");
  }
  if (!Array.isArray(manifest.variants) || manifest.variants.length < 2) throw new Error("experiment requires at least two variants");
  const ids = new Set<string>();
  const algorithmManifestHashes = new Set<string>();
  let allocation = 0;
  for (const variant of manifest.variants) {
    requiredText(variant.id, "experiment variant id");
    if (ids.has(variant.id)) throw new Error(`duplicate experiment variant: ${variant.id}`);
    ids.add(variant.id);
    if (!Number.isSafeInteger(variant.allocationBasisPoints) || variant.allocationBasisPoints < 1) {
      throw new Error(`experiment variant ${variant.id} allocation must be positive basis points`);
    }
    allocation += variant.allocationBasisPoints;
    validateAlgorithmRef(variant.algorithmRef);
    if (algorithmManifestHashes.has(variant.algorithmRef.manifestHash)) {
      throw new Error(`experiment variants must pin distinct algorithms: ${variant.algorithmRef.manifestHash}`);
    }
    algorithmManifestHashes.add(variant.algorithmRef.manifestHash);
  }
  if (allocation !== 10_000) throw new Error(`experiment allocations must sum to 10000 basis points, got ${allocation}`);
  const { hash, ...withoutHash } = manifest;
  if (contentHash(withoutHash) !== hash) throw new Error(`experiment manifest hash mismatch: ${manifest.id}@${manifest.version}`);
}

function enrollmentBody(value: Omit<ExperimentEnrollment, "assignmentHash">): Omit<ExperimentEnrollment, "assignmentHash"> {
  return structuredClone(value);
}

export class AlgorithmExperimentRegistry {
  private readonly manifests = new Map<string, AlgorithmExperimentManifest>();
  private activeWorldExecution?: string;
  private enrollmentStoppedReason?: string;

  constructor(
    private readonly algorithms: WorldExecutionAlgorithmRegistry,
    private readonly safetyStore?: ExperimentEnrollmentSafetyStore,
  ) {}

  register(manifest: AlgorithmExperimentManifest): void {
    validateAlgorithmExperimentManifest(manifest);
    for (const variant of manifest.variants) {
      if (!this.algorithms.has(variant.algorithmRef)) {
        throw new Error(`experiment variant algorithm is not registered: ${variant.algorithmRef.id}@${variant.algorithmRef.version}`);
      }
      this.algorithms.validateExperimentComposition(variant.algorithmRef);
    }
    const key = `${manifest.id}@${manifest.version}`;
    if (this.manifests.has(key)) throw new Error(`algorithm experiment is already registered: ${key}`);
    this.manifests.set(key, structuredClone(manifest));
  }

  activate(experimentId: string, version: string): void {
    const key = `${experimentId}@${version}`;
    if (!this.manifests.has(key)) throw new Error(`algorithm experiment is not registered: ${key}`);
    if (this.activeWorldExecution && this.activeWorldExecution !== key) {
      throw new Error(`world-execution layer already has an active experiment: ${this.activeWorldExecution}`);
    }
    this.activeWorldExecution = key;
    this.enrollmentStoppedReason = this.safetyStore?.readExperimentEnrollmentStop(experimentId, version);
  }

  active(): AlgorithmExperimentManifest | undefined {
    return this.activeWorldExecution ? structuredClone(this.manifests.get(this.activeWorldExecution)) : undefined;
  }

  stopNewEnrollment(reason: string): void {
    requiredText(reason, "experiment enrollment stop reason");
    if (this.enrollmentStoppedReason) return;
    this.enrollmentStoppedReason = reason;
    const manifest = this.active();
    if (manifest && this.safetyStore) {
      this.safetyStore.writeExperimentEnrollmentStop(manifest.id, manifest.version, reason);
      const persisted = this.safetyStore.readExperimentEnrollmentStop(manifest.id, manifest.version);
      if (!persisted) throw new Error(`failed to persist enrollment stop for ${manifest.id}@${manifest.version}`);
      this.enrollmentStoppedReason = persisted;
      return;
    }
  }

  enrollmentStatus(): { stopped: boolean; reason?: string } {
    return this.enrollmentStoppedReason
      ? { stopped: true, reason: this.enrollmentStoppedReason }
      : { stopped: false };
  }

  enrollment(input: {
    instanceId: string;
    worldContentHash: string;
    defaultAlgorithmRef: AlgorithmRef;
    explicitExecutionTuning: boolean;
  }): ExperimentEnrollmentDecision {
    if (input.explicitExecutionTuning) {
      return { enrollment: null, algorithmRef: structuredClone(input.defaultAlgorithmRef), exclusionReason: "explicit-execution-tuning" };
    }
    if (this.enrollmentStoppedReason) {
      return {
        enrollment: null,
        algorithmRef: structuredClone(input.defaultAlgorithmRef),
        exclusionReason: "experiment-stopped",
        exclusionDetail: this.enrollmentStoppedReason,
      };
    }
    const manifest = this.active();
    if (!manifest) return { enrollment: null, algorithmRef: structuredClone(input.defaultAlgorithmRef), exclusionReason: "no-active-experiment" };
    if (!manifest.eligibility.worldContentHashes.includes(input.worldContentHash)) {
      return { enrollment: null, algorithmRef: structuredClone(input.defaultAlgorithmRef), exclusionReason: "world-ineligible" };
    }
    const bucket = experimentAssignmentBucket({
      experimentManifestHash: manifest.hash,
      salt: manifest.salt,
      instanceId: input.instanceId,
      assignmentVersion: manifest.version,
    });
    let boundary = 0;
    const variant = manifest.variants.find((entry) => {
      boundary += entry.allocationBasisPoints;
      return bucket < boundary;
    });
    if (!variant) throw new Error(`experiment ${manifest.id}@${manifest.version} did not assign bucket ${bucket}`);
    const partial = enrollmentBody({
      experimentId: manifest.id,
      experimentVersion: manifest.version,
      experimentManifestHash: manifest.hash,
      variantId: variant.id,
      bucket,
      algorithmRef: variant.algorithmRef,
    });
    const enrollment = { ...partial, assignmentHash: contentHash(partial) };
    return { enrollment, algorithmRef: structuredClone(variant.algorithmRef) };
  }

  validateEnrollment(instanceId: string, enrollment: ExperimentEnrollment): void {
    const key = `${enrollment.experimentId}@${enrollment.experimentVersion}`;
    const manifest = this.manifests.get(key);
    if (!manifest) throw new Error(`historical experiment manifest is missing: ${key}`);
    if (manifest.hash !== enrollment.experimentManifestHash) throw new Error(`experiment manifest drift for ${key}`);
    const expectedBucket = experimentAssignmentBucket({
      experimentManifestHash: manifest.hash,
      salt: manifest.salt,
      instanceId,
      assignmentVersion: manifest.version,
    });
    if (expectedBucket !== enrollment.bucket) throw new Error(`experiment bucket drift for instance ${instanceId}`);
    const variant = manifest.variants.find((entry) => entry.id === enrollment.variantId);
    if (!variant || contentHash(variant.algorithmRef) !== contentHash(enrollment.algorithmRef)) {
      throw new Error(`experiment variant drift for instance ${instanceId}`);
    }
    const { assignmentHash, ...withoutHash } = enrollment;
    if (contentHash(withoutHash) !== assignmentHash) throw new Error(`experiment assignment hash mismatch for instance ${instanceId}`);
  }

  manifest(id: string, version: string): AlgorithmExperimentManifest | undefined {
    const value = this.manifests.get(`${id}@${version}`);
    return value ? structuredClone(value) : undefined;
  }

  all(): readonly AlgorithmExperimentManifest[] {
    return [...this.manifests.values()]
      .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version))
      .map((manifest) => structuredClone(manifest));
  }
}
