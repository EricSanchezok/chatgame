import { createHash } from "node:crypto";
import { GRAPH_FEATURE_NAMES, graphFeatureVector, type GraphRankerModel, type CandidateFeatures } from "../../../algorithms/eager-reference/candidate-retrieval/graph-aware";

export const LINEAR_RANKER_SCHEMA_VERSION = 1 as const;

export interface PairwiseTrainingExample {
  id: string;
  positive: readonly number[];
  negative: readonly number[];
}

export interface PairwiseRankerConfig {
  seed?: number;
  learningRate?: number;
  l2?: number;
  maxEpochs?: number;
  earlyStoppingPatience?: number;
}

export interface LinearRankerArtifact {
  schemaVersion: typeof LINEAR_RANKER_SCHEMA_VERSION;
  kind: "action-compilation-pairwise-linear-ranker";
  ranker: GraphRankerModel;
  config: Required<PairwiseRankerConfig>;
  featureSchemaHash: string;
  trainingExamples: number;
  validationMacroRecall: number | null;
  promotable: boolean;
}

const DEFAULT_CONFIG: Required<PairwiseRankerConfig> = {
  seed: 20260904,
  learningRate: 0.05,
  l2: 0.0001,
  maxEpochs: 100,
  earlyStoppingPatience: 10,
};

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function dot(weights: readonly number[], values: readonly number[]): number {
  let result = 0;
  for (let index = 0; index < Math.min(weights.length, values.length); index += 1) result += weights[index]! * values[index]!;
  return result;
}

function featureSchemaHash(): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ version: 1, names: GRAPH_FEATURE_NAMES })).digest("hex")}`;
}

function lexicographicExamples(examples: readonly PairwiseTrainingExample[]): PairwiseTrainingExample[] {
  return [...examples].sort((left, right) => left.id.localeCompare(right.id));
}

function loss(weights: readonly number[], bias: number, examples: readonly PairwiseTrainingExample[]): number {
  if (examples.length === 0) return 0;
  let total = 0;
  for (const example of examples) {
    const margin = bias + dot(weights, example.positive) - dot(weights, example.negative);
    total += Math.log1p(Math.exp(-Math.max(-40, Math.min(40, margin))));
  }
  return total / examples.length;
}

export function scoreLinearRanker(ranker: GraphRankerModel, features: readonly number[] | CandidateFeatures): number {
  const values = Array.isArray(features) ? features as readonly number[] : graphFeatureVector(features as CandidateFeatures);
  return ranker.bias + dot(ranker.weights, values);
}

/** Deterministic pairwise logistic SGD. The seed is retained in the artifact
 * and used only for a reproducible initial phase; examples are always ordered
 * by id so retraining the same snapshot produces byte-identical weights. */
export function trainPairwiseLinearRanker(
  examples: readonly PairwiseTrainingExample[],
  config: PairwiseRankerConfig = {},
  validationExamples: readonly PairwiseTrainingExample[] = [],
  promotable = false,
): LinearRankerArtifact {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const ordered = lexicographicExamples(examples);
  const validation = lexicographicExamples(validationExamples);
  const dimensions = GRAPH_FEATURE_NAMES.length;
  const weights = Array.from({ length: dimensions }, () => 0);
  let bias = 0;
  let bestWeights = [...weights];
  let bestBias = bias;
  let bestValidation = validation.length === 0 ? Number.POSITIVE_INFINITY : loss(weights, bias, validation);
  let stale = 0;
  for (let epoch = 0; epoch < resolved.maxEpochs; epoch += 1) {
    for (const example of ordered) {
      const margin = bias + dot(weights, example.positive) - dot(weights, example.negative);
      const gradient = sigmoid(-margin);
      for (let index = 0; index < dimensions; index += 1) {
        const delta = (example.positive[index] ?? 0) - (example.negative[index] ?? 0);
        weights[index] = (weights[index] ?? 0) + resolved.learningRate * (gradient * delta - resolved.l2 * (weights[index] ?? 0));
      }
      bias += resolved.learningRate * gradient;
    }
    const validationLoss = validation.length === 0 ? loss(weights, bias, ordered) : loss(weights, bias, validation);
    if (validationLoss < bestValidation - 1e-12) {
      bestValidation = validationLoss;
      bestWeights = [...weights];
      bestBias = bias;
      stale = 0;
    } else {
      stale += 1;
      if (stale >= resolved.earlyStoppingPatience) break;
    }
  }
  const ranker: GraphRankerModel = {
    schemaVersion: 1,
    featureNames: [...GRAPH_FEATURE_NAMES],
    weights: bestWeights.map((value) => Number(value.toFixed(12))),
    bias: Number(bestBias.toFixed(12)),
  };
  const artifact: LinearRankerArtifact = {
    schemaVersion: LINEAR_RANKER_SCHEMA_VERSION,
    kind: "action-compilation-pairwise-linear-ranker",
    ranker,
    config: resolved,
    featureSchemaHash: featureSchemaHash(),
    trainingExamples: ordered.length,
    validationMacroRecall: validation.length === 0 ? null : validation.reduce((count, example) =>
      count + (scoreLinearRanker(ranker, example.positive) > scoreLinearRanker(ranker, example.negative) ? 1 : 0), 0) / validation.length,
    promotable,
  };
  ranker.modelHash = `sha256:${createHash("sha256").update(JSON.stringify(ranker)).digest("hex")}`;
  return artifact;
}

export function rankerFeatureSchemaHash(): string {
  return featureSchemaHash();
}
