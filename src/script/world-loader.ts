import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type {
  AgentBeliefState,
  AgentCharacterState,
  AgentState,
  DiscreteRandomDefinition,
  MechanicsCatalog,
  PlayerKnowledgeState,
  SimulationState,
} from "../engine/model";
import { historyReplayBaseHash } from "../engine/history-replay";
import { createSeededRng, validateDiscreteRandomDefinitions } from "../engine/random";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";
import { validateSimulationState } from "../engine/transaction";
import type { WorldDefinition } from "../engine/world-definition";
import { validateWorldDefinition, validateWorldModelProfiles } from "../engine/world-definition";
import type { ModelCatalog } from "../engine/model-catalog";
import { canonicalize, contentHash } from "../engine/model-audit";
import {
  entityDocumentSchema,
  lawsFileSchema,
  mechanicsFileSchema,
  playerDocumentSchema,
  scriptManifestSchema,
  type EntityDocument,
  type LawsDocument,
  type MechanicsDocument,
  type PlayerDocument,
  type ScriptManifestDocument,
} from "./contract";

export class WorldScriptError extends Error {
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "WorldScriptError";
  }
}

function readYaml(file: string): unknown {
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new WorldScriptError(file, "required file is missing");
  }
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new WorldScriptError(file, error instanceof Error ? error.message : String(error));
  }
}

function parseDocument<T>(
  file: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } } },
): T {
  const parsed = schema.safeParse(readYaml(file));
  if (!parsed.success) throw new WorldScriptError(file, parsed.error.message);
  return parsed.data;
}

function uniqueRecord<T extends { id: string }>(entries: T[], label: string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const entry of entries) {
    if (result[entry.id]) throw new Error(`duplicate ${label} id ${entry.id}`);
    result[entry.id] = entry;
  }
  return result;
}

function mechanicsCatalog(document: MechanicsDocument): MechanicsCatalog {
  for (const meter of document.meters) {
    if (meter.max <= meter.min) throw new Error(`meter ${meter.id} requires max > min`);
    for (const threshold of meter.thresholds) {
      if (threshold.when.value < meter.min || threshold.when.value > meter.max) {
        throw new Error(`meter threshold ${threshold.id} is outside ${meter.id} range`);
      }
    }
  }
  for (const rating of document.ratings) {
    if (rating.max < rating.min) throw new Error(`rating ${rating.id} requires max >= min`);
  }
  return {
    meters: uniqueRecord(document.meters, "meter"),
    quantities: uniqueRecord(
      document.quantities.map((quantity) => ({
        id: quantity.id,
        name: quantity.name,
        unit: quantity.unit,
        productionLawIds: quantity.production_law_ids,
        consumptionLawIds: quantity.consumption_law_ids,
      })),
      "quantity",
    ),
    ratings: uniqueRecord(document.ratings, "rating"),
  };
}

function randomDistributions(document: MechanicsDocument): DiscreteRandomDefinition[] {
  const definitions = document.random_distributions.map((distribution) => ({
    id: distribution.id,
    description: distribution.description,
    steps: distribution.steps.map((step) => ({
      id: step.id,
      count: step.count,
      outcomes: structuredClone(step.outcomes),
      aggregate: step.aggregate,
      when: step.when ? { stepId: step.when.step_id, equals: structuredClone(step.when.equals) } : null,
    })),
  }));
  validateDiscreteRandomDefinitions(definitions);
  return definitions;
}

function beliefFrom(document: EntityDocument["agent"]): AgentBeliefState {
  if (!document) return { localEntities: {}, claims: {}, evidence: {} };
  return {
    localEntities: uniqueRecord(document.belief.local_entities, "local entity"),
    claims: uniqueRecord(document.belief.claims, "belief claim"),
    evidence: uniqueRecord(document.belief.evidence, "belief evidence"),
  };
}

function characterFrom(document: NonNullable<EntityDocument["agent"]>): AgentCharacterState {
  const atStepZero = <T extends { id: string; evidence_ids: string[] }>({ evidence_ids, ...entry }: T) => ({
    ...entry,
    evidenceIds: evidence_ids,
    createdAtStep: 0,
    updatedAtStep: 0,
  });
  return {
    persona: {
      summary: document.character.persona.summary,
      voice: document.character.persona.voice,
      updatedAtStep: 0,
      evidenceIds: document.character.persona.evidence_ids,
    },
    traits: uniqueRecord(document.character.traits.map(atStepZero), "trait"),
    values: uniqueRecord(document.character.values.map(atStepZero), "value"),
    emotions: uniqueRecord(document.character.emotions.map(atStepZero), "emotion"),
    attitudes: uniqueRecord(document.character.attitudes.map((entry) => {
      const { subject_id, ...attitude } = atStepZero(entry);
      return { ...attitude, subjectId: subject_id };
    }), "attitude"),
    goals: uniqueRecord(document.character.goals.map((entry) => {
      const {
        target_ids,
        parent_goal_id,
        motivated_by_ids,
        ...goal
      } = atStepZero(entry);
      return {
        ...goal,
        targetIds: target_ids,
        parentGoalId: parent_goal_id,
        motivatedByIds: motivated_by_ids,
      };
    }), "goal"),
    commitments: uniqueRecord(document.character.commitments.map((entry) => {
      const { subject_ids, ...commitment } = atStepZero(entry);
      return { ...commitment, subjectIds: subject_ids };
    }), "commitment"),
  };
}

function agentFrom(document: EntityDocument): AgentState | undefined {
  if (!document.agent) return undefined;
  return {
    id: document.agent.id,
    entityId: document.id,
    modelProfiles: {
      bootstrap: document.agent.model_profiles.bootstrap,
      mind: document.agent.model_profiles.mind,
      reaction: document.agent.model_profiles.reaction,
    },
    character: characterFrom(document.agent),
    belief: beliefFrom(document.agent),
    bindings: Object.fromEntries(
      document.agent.belief.bindings.map((binding) => [
        binding.local_entity_id,
        {
          localEntityId: binding.local_entity_id,
          canonicalEntityIds: binding.canonical_entity_ids,
        },
      ]),
    ),
    nextAction: null,
  };
}

function playerKnowledge(document: ReturnType<typeof playerDocumentSchema.parse>): PlayerKnowledgeState {
  return {
    localEntities: uniqueRecord(document.local_entities, "player local entity"),
    evidence: uniqueRecord(document.evidence, "player evidence"),
    claims: uniqueRecord(document.claims, "player claim"),
    observationIds: [],
  };
}

function entityFiles(scriptDir: string): string[] {
  const directory = path.join(scriptDir, "entities");
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new WorldScriptError(directory, "entities directory is missing");
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => path.join(directory, name));
}

export function validateWorldScriptLayout(scriptDir: string): void {
  const root = path.resolve(scriptDir);
  const rootFiles = new Set(["script.yaml", "laws.yaml", "mechanics.yaml", "player.yaml"]);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) throw new WorldScriptError(absolute, "symbolic links are not allowed");
    if (entry.isDirectory()) {
      if (entry.name !== "entities") throw new WorldScriptError(absolute, "unexpected directory");
      for (const entityEntry of readdirSync(absolute, { withFileTypes: true })) {
        const entityFile = path.join(absolute, entityEntry.name);
        if (!entityEntry.isFile() || !/\.ya?ml$/.test(entityEntry.name)) {
          throw new WorldScriptError(entityFile, "entities may contain YAML files only");
        }
      }
      continue;
    }
    if (!entry.isFile() || !rootFiles.has(entry.name)) {
      throw new WorldScriptError(absolute, "unexpected world script file");
    }
  }
}

export interface LoadWorldScriptOptions {
  modelCatalog: ModelCatalog;
  seed?: number;
  rulePackages?: RulePackageRegistry;
}

export interface NormalizedWorldTemplate {
  manifest: ScriptManifestDocument;
  laws: LawsDocument;
  mechanics: MechanicsDocument;
  player: PlayerDocument;
  entities: EntityDocument[];
}

const normalizedWorldTemplateSchema = z.strictObject({
  manifest: scriptManifestSchema,
  laws: lawsFileSchema,
  mechanics: mechanicsFileSchema,
  player: playerDocumentSchema,
  entities: z.array(entityDocumentSchema).min(1),
});

export function parseWorldTemplate(value: unknown): NormalizedWorldTemplate {
  const template = normalizedWorldTemplateSchema.parse(value);
  template.entities.sort((left, right) => left.id.localeCompare(right.id));
  return template;
}

export function hashWorldTemplate(template: NormalizedWorldTemplate): string {
  return `sha256:${contentHash(canonicalize(template))}`;
}

export function loadWorldTemplate(scriptDir: string): NormalizedWorldTemplate {
  const root = path.resolve(scriptDir);
  validateWorldScriptLayout(root);
  const entities = entityFiles(root)
    .map((file) => parseDocument(file, entityDocumentSchema))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (entities.length === 0) {
    throw new WorldScriptError(path.join(root, "entities"), "at least one entity is required");
  }
  return parseWorldTemplate({
    manifest: parseDocument(path.join(root, "script.yaml"), scriptManifestSchema),
    laws: parseDocument(path.join(root, "laws.yaml"), lawsFileSchema),
    mechanics: parseDocument(path.join(root, "mechanics.yaml"), mechanicsFileSchema),
    player: parseDocument(path.join(root, "player.yaml"), playerDocumentSchema),
    entities,
  });
}

export function buildWorldDefinition(
  template: NormalizedWorldTemplate,
  options: LoadWorldScriptOptions,
): WorldDefinition {
  const seed = options.seed ?? 1;
  const rulePackages = options.rulePackages ?? createCoreRulePackageRegistry();
  const { manifest, laws, mechanics: mechanicsDocument, player, entities: documents } = template;
  const worldHash = hashWorldTemplate(template);
  try {
    const mechanics = mechanicsCatalog(mechanicsDocument);
    const state: SimulationState = {
      schemaVersion: 7,
      worldId: manifest.id,
      worldHash,
      lawIds: laws.laws.map((law) => law.id),
      revision: 0,
      step: 0,
      truth: {
        elapsedSeconds: 0,
        rng: createSeededRng(seed),
        events: [],
        entities: {},
        placements: {},
        facts: {},
        mechanics,
        meters: {},
        quantities: {},
        ratings: {},
      },
      agents: {},
      player: {
        entityId: player.entity_id,
        knowledge: playerKnowledge(player),
        bindings: Object.fromEntries(
          player.bindings.map((binding) => [
            binding.local_entity_id,
            { localEntityId: binding.local_entity_id, canonicalEntityIds: binding.canonical_entity_ids },
          ]),
        ),
      },
      history: [],
      bootstrapModelAudits: [],
    };

    for (const document of documents) {
      if (state.truth.entities[document.id]) throw new Error(`duplicate entity id ${document.id}`);
      state.truth.entities[document.id] = {
        id: document.id,
        kind: document.kind,
        name: document.name,
        description: document.description,
        lifecycle: "active",
        createdAtStep: 0,
      };
      state.truth.placements[document.id] = document.placement;
      for (const fact of document.facts) {
        if (state.truth.facts[fact.id]) throw new Error(`duplicate fact id ${fact.id}`);
        state.truth.facts[fact.id] = {
          ...fact,
          subjectId: document.id,
          provenance: [{ kind: "world_seed", id: worldHash }],
        };
      }
      for (const meter of document.meters) {
        if (state.truth.meters[meter.id]) throw new Error(`duplicate meter id ${meter.id}`);
        state.truth.meters[meter.id] = {
          id: meter.id,
          definitionId: meter.definition_id,
          entityId: document.id,
          current: meter.current,
          firedThresholdIds: [],
        };
      }
      for (const quantity of document.quantities) {
        const id = `${quantity.definition_id}:${document.id}`;
        if (state.truth.quantities[id]) throw new Error(`duplicate quantity id ${id}`);
        state.truth.quantities[id] = {
          id,
          definitionId: quantity.definition_id,
          holderId: document.id,
          amount: quantity.amount,
        };
      }
      for (const rating of document.ratings) {
        if (state.truth.ratings[rating.id]) throw new Error(`duplicate rating id ${rating.id}`);
        state.truth.ratings[rating.id] = {
          id: rating.id,
          definitionId: rating.definition_id,
          entityId: document.id,
          value: rating.value,
        };
      }
      const agent = agentFrom(document);
      if (agent) {
        if (state.agents[agent.id]) throw new Error(`duplicate agent id ${agent.id}`);
        state.agents[agent.id] = agent;
      }
    }

    const definition: WorldDefinition = {
      id: manifest.id,
      name: manifest.name,
      manifestVersion: manifest.version,
      description: manifest.description,
      contentHash: worldHash,
      modelProfiles: {
        perception: manifest.model_profiles.perception,
        reactionRouting: manifest.model_profiles.reaction_routing,
        resolution: manifest.model_profiles.resolution,
        transition: manifest.model_profiles.transition,
        causalVerifier: manifest.model_profiles.causal_verifier,
      },
      laws: laws.laws,
      disclosure: { defaultCheckVisibility: laws.disclosure.default_check_visibility },
      rulePackages: rulePackages.validate(mechanicsDocument.rule_packages.map((reference) => ({
        id: reference.id,
        version: reference.version,
        config: reference.config,
      }))),
      randomDistributions: randomDistributions(mechanicsDocument),
      historyBaseHash: historyReplayBaseHash(state),
      initialState: state,
    };
    validateWorldDefinition(definition);
    validateWorldModelProfiles(definition, options.modelCatalog);
    validateSimulationState(state, false);
    return definition;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export function loadWorldScript(scriptDir: string, options: LoadWorldScriptOptions): WorldDefinition {
  const root = path.resolve(scriptDir);
  try {
    return buildWorldDefinition(loadWorldTemplate(root), options);
  } catch (error) {
    if (error instanceof WorldScriptError) throw error;
    throw new WorldScriptError(root, error instanceof Error ? error.message : String(error));
  }
}
