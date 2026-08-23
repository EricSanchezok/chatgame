import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import type { WorldSessionDocument } from "../../server/world-run-types";
import { MemoryWorldSessionStore } from "../../server/world-session-store";
import { AgentMind } from "../agent-mind";
import { evaluateProposalCausality } from "../causality";
import type {
  CommittedStep,
  DiscreteRandomDefinition,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  TransitionProposal,
} from "../model";
import { contentHash } from "../model-audit";
import {
  MAX_RANDOM_REQUESTS_PER_ROUND,
  MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP,
} from "../random-limits";
import {
  createSeededRng,
  drawInteger,
  resolveD20Checks,
  resolveDiscreteRandomRequests,
  validateDiscreteRandomDefinitions,
} from "../random";
import { SimulationEngine } from "../simulation";
import { ScriptedModelProvider, createTestModelCatalog } from "../testing/model-provider";
import { validateSimulationState } from "../transaction";
import { TruthEngine } from "../truth-engine";
import { toWorldRuntimeContract } from "../world-definition";

const fixture = path.resolve("test/fixtures/open-world-script");
const catalog = createTestModelCatalog(["truth-deepseek", "agent-deepseek"]);

function fixtureWorld(seed = 2026) {
  return loadWorldScript(fixture, { seed, modelCatalog: catalog });
}

function distribution(id: string): DiscreteRandomDefinition {
  const found = fixtureWorld().randomDistributions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing fixture distribution ${id}`);
  return found;
}

function request(id: string, definition: DiscreteRandomDefinition): DiscreteRandomRequest {
  return {
    id,
    distributionId: definition.id,
    distribution: structuredClone(definition),
    causes: [{ kind: "law", id: "time-passes" }],
  };
}

function resultStep(result: DiscreteRandomResult, stepId: string) {
  const step = result.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) throw new Error(`missing random result step ${stepId}`);
  return step;
}

function refreshCommittedStepHash(step: CommittedStep): void {
  const payload = { ...step } as Partial<CommittedStep>;
  delete payload.contentHash;
  step.contentHash = contentHash(payload);
}

describe("committed discrete random", () => {
  it("replays equal-slot count distributions deterministically with only legal results", () => {
    const fourSix = distribution("four-six-sum");
    const fiveTen = distribution("five-ten-sum");
    const requests = [request("four-six", fourSix), request("five-ten", fiveTen)];

    const first = resolveDiscreteRandomRequests(createSeededRng(91), requests);
    const replay = resolveDiscreteRandomRequests(createSeededRng(91), requests);

    expect(replay).toEqual(first);
    expect(first.rng.draws).toBeGreaterThanOrEqual(9);
    const fourSixStep = resultStep(first.results[0], "amount");
    const fiveTenStep = resultStep(first.results[1], "amount");
    expect(fourSixStep.draws).toHaveLength(4);
    expect(fiveTenStep.draws).toHaveLength(5);
    for (const [definition, step] of [[fourSix, fourSixStep], [fiveTen, fiveTenStep]] as const) {
      const slots = definition.steps[0].outcomes;
      for (const draw of step.draws) {
        expect(draw.outcomeIndex).toBeGreaterThanOrEqual(0);
        expect(draw.outcomeIndex).toBeLessThan(slots.length);
        expect(draw.value).toBe(slots[draw.outcomeIndex]);
      }
      expect(step.aggregate).toBe(step.draws.reduce((sum, draw) => sum + Number(draw.value), 0));
    }
    expect(fourSixStep.aggregate).toBeGreaterThanOrEqual(4);
    expect(fourSixStep.aggregate).toBeLessThanOrEqual(24);
    expect(fiveTenStep.aggregate).toBeGreaterThanOrEqual(5);
    expect(fiveTenStep.aggregate).toBeLessThanOrEqual(50);
  });

  it("executes conditional 1/4 plus 4-by-4 and 3/6 plus 4:2 branches exactly", () => {
    const hourly = distribution("hourly-four-four");
    const branched = distribution("three-six-four-two");
    const hourlyStates = new Set<boolean>();
    const branchValues = new Set<string>();

    for (let seed = 1; seed <= 512; seed += 1) {
      const hourlyResolution = resolveDiscreteRandomRequests(
        createSeededRng(seed),
        [request(`hourly-${seed}`, hourly)],
      );
      const triggered = resultStep(hourlyResolution.results[0], "triggered");
      const groupSize = resultStep(hourlyResolution.results[0], "group-size");
      const didTrigger = triggered.aggregate === true;
      hourlyStates.add(didTrigger);
      expect(triggered.draws).toHaveLength(1);
      expect(groupSize.skipped).toBe(!didTrigger);
      expect(groupSize.draws).toHaveLength(didTrigger ? 4 : 0);
      expect(hourlyResolution.rng.draws).toBe(didTrigger ? 5 : 1);
      if (didTrigger) {
        expect(groupSize.aggregate).toBeGreaterThanOrEqual(4);
        expect(groupSize.aggregate).toBeLessThanOrEqual(16);
      } else {
        expect(groupSize.aggregate).toBeNull();
      }

      const branchResolution = resolveDiscreteRandomRequests(
        createSeededRng(seed),
        [request(`branch-${seed}`, branched)],
      );
      const branchTriggered = resultStep(branchResolution.results[0], "triggered");
      const branch = resultStep(branchResolution.results[0], "branch");
      const didBranch = branchTriggered.aggregate === true;
      expect(branch.skipped).toBe(!didBranch);
      expect(branch.draws).toHaveLength(didBranch ? 1 : 0);
      expect(branchResolution.rng.draws).toBeGreaterThanOrEqual(didBranch ? 2 : 1);
      if (didBranch) {
        expect(["first", "second"]).toContain(branch.aggregate);
        branchValues.add(String(branch.aggregate));
      } else {
        expect(branch.aggregate).toBeNull();
      }
    }

    expect(hourlyStates).toEqual(new Set([false, true]));
    expect(branchValues).toEqual(new Set(["first", "second"]));
    expect(branched.steps[0].outcomes).toEqual([false, false, false, true, true, true]);
    expect(branched.steps[1].outcomes).toEqual([
      "first", "first", "first", "first", "second", "second",
    ]);
  });

  it("replays rejection sampling when equal-slot selection consumes an extra RNG draw", () => {
    const hundredSlots: DiscreteRandomDefinition = {
      id: "hundred-equal-slots",
      description: "用于验证无偏槽位选择的百槽分布。",
      steps: [{
        id: "selected",
        count: 1,
        outcomes: Array.from({ length: 100 }, (_, index) => index),
        aggregate: "first",
        when: null,
      }],
    };
    // The first uint32 emitted from this committed state is 4_294_967_229,
    // which lies in the 96-value rejection tail for one hundred equal slots.
    const initial = createSeededRng(19_969_067);
    const first = resolveDiscreteRandomRequests(initial, [request("rejection", hundredSlots)]);
    const replay = resolveDiscreteRandomRequests(initial, [request("rejection", hundredSlots)]);
    const integer = drawInteger(initial, 0, 99);

    expect(first).toEqual(replay);
    expect(first.rng.draws).toBe(2);
    expect(integer[0]).toBe(resultStep(first.results[0], "selected").aggregate);
    expect(integer[1]).toEqual(first.rng);
    expect(resultStep(first.results[0], "selected").draws).toHaveLength(1);
    expect(resultStep(first.results[0], "selected").aggregate).toBeGreaterThanOrEqual(0);
    expect(resultStep(first.results[0], "selected").aggregate).toBeLessThan(100);

    expect(() => drawInteger(initial, 0, 4294967296)).toThrow("span cannot exceed 2^32");
  });

  it("rejects ambiguous or non-executable distribution definitions", () => {
    const valid = distribution("four-six-sum");
    expect(() => validateDiscreteRandomDefinitions([{ ...valid, id: "invalid-first", steps: [{
      ...valid.steps[0],
      count: 2,
      aggregate: "first",
    }] }])).toThrow("uses first with count 2");
    expect(() => validateDiscreteRandomDefinitions([{ ...valid, id: "invalid-sum", steps: [{
      ...valid.steps[0],
      outcomes: [1, "two"],
    }] }])).toThrow("sum requires numeric outcomes");
    expect(() => validateDiscreteRandomDefinitions([{ ...valid, id: "negative-zero", steps: [{
      ...valid.steps[0],
      outcomes: [0, -0],
    }] }])).toThrow("invalid numeric outcome");
    expect(() => validateDiscreteRandomDefinitions([{ ...valid, id: "forward-branch", steps: [{
      ...valid.steps[0],
      id: "first",
      when: { stepId: "later", equals: true },
    }] }])).toThrow("must reference a prior step");
  });

  it("commits the hydrated distribution and rejects a tampered RNG audit through the real engine", async () => {
    const definition = fixtureWorld(73);
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        baseRevision: number;
        step: number;
        agent?: { id: string };
        jointActions?: Array<{ id: string; actorId: string }>;
        agentEpistemics?: Record<string, unknown>;
        world?: { randomDistributions: DiscreteRandomDefinition[] };
        canonicalTruth?: { elapsedSeconds: number };
        checkResults?: Array<{ requestId: string; succeeded: boolean }>;
        randomResults?: DiscreteRandomResult[];
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        const agentId = context.agent!.id;
        return {
          beliefPatch: { agentId, baseRevision: context.revision, operations: [] },
          characterPatch: { agentId, baseRevision: context.revision, operations: [] },
          nextAction: {
            id: `next:${agentId}:${context.revision}`,
            actorId: agentId,
            baseRevision: context.revision,
            rawText: "继续履行自己的职责",
            goal: "履行职责",
            means: null,
            targetIds: [],
          },
        };
      }
      const idSuffix = context.step === 0 ? "" : `:${context.step + 1}`;
      const checkId = `committed-check${idSuffix}`;
      const randomId = `committed-yield${idSuffix}`;
      if (!context.checkResults?.length) {
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        return {
          kind: "request_checks",
          requests: [{
            id: checkId,
            actorId: "player",
            targetId: null,
            ratingId: null,
            modifier: 0,
            modifierSources: [],
            dc: 0,
            mode: "normal",
            stakes: "先固定本步骤的 d20 结算。",
            visibility: "hidden",
            phase: "resolution",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }
      if (!context.randomResults?.length) {
        expect(context.world?.randomDistributions).toEqual(definition.randomDistributions);
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        return {
          kind: "request_random",
          requests: [{
            id: randomId,
            distributionId: "four-six-sum",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }

      const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
      const amount = resultStep(context.randomResults[0], "amount").aggregate;
      const nextStep = context.step + 1;
      const elapsedSeconds = context.canonicalTruth!.elapsedSeconds;
      const eventId = `event:random:${nextStep}`;
      const proposal: TransitionProposal = {
        baseRevision: context.baseRevision,
        outcomes: context.jointActions!.map((action) => ({
          proposalId: action.id,
          status: action.actorId === "player" ? "succeeded" : "continuing",
          summary: "行动按已提交的世界随机结果结算。",
          causeRefs: action.actorId === "player"
            ? [
                { kind: "action", id: playerAction.id },
                { kind: "check", id: checkId },
                { kind: "random", id: randomId },
              ]
            : [{ kind: "action", id: action.id }],
          assertions: action.actorId === "player"
            ? [
                {
                  kind: "check_result",
                  checkId,
                  expected: context.checkResults![0].succeeded ? "succeeded" : "failed",
                },
                {
                  kind: "random_result",
                  requestId: randomId,
                  stepId: "amount",
                  expected: amount!,
                },
              ]
            : [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
          knownAlternatives: [],
        })),
        mechanicInvocations: [],
        operations: [{
          kind: "advance_time",
          seconds: 1,
          causes: [{ kind: "law", id: "time-passes" }],
          assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: elapsedSeconds }],
        }],
        events: [{
          id: eventId,
          step: nextStep,
          description: "世界完成一次随机结算。",
          impact: "ordinary",
          causes: [{ kind: "law", id: "time-passes" }],
          assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: elapsedSeconds + 1 }],
        }],
        observations: ["player", ...Object.keys(context.agentEpistemics ?? {})].map((observerId) => ({
          id: `observation:${observerId}:${nextStep}`,
          observerId,
          step: nextStep,
          kind: "outcome",
          summary: "你看到了这次结算的表面结果。",
          introductions: [],
          apparentClaims: [],
          sourceEventIds: [eventId],
        })),
        intentStatus: "completed",
        requiresPlayerDecision: false,
      };
      return { kind: "transition", proposal };
    });
    const engine = new SimulationEngine(definition, new TruthEngine(provider), new AgentMind(provider));
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("触发一次世界声明的随机产出");
    const stateBeforeStep = engine.snapshot;

    const result = await engine.step();

    const committedRequest = result.committed.randomRequests[0];
    const committedResult = result.committed.randomResults[0];
    expect(committedRequest.distribution).toEqual(distribution("four-six-sum"));
    expect(result.committed.rngAfter.draws - result.committed.rngBefore.draws).toBe(5);
    expect(result.committed.commitmentRounds).toEqual([
      { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
      { kind: "random", requestIds: ["committed-yield"] },
    ]);
    const transitionContext = provider.requests.find((modelRequest) =>
      modelRequest.role === "truth-transition")!.context as { commitmentRounds: unknown };
    const verifierContext = provider.requests.find((modelRequest) =>
      modelRequest.role === "causal-verifier")!.context as { commitmentRounds: unknown };
    expect(transitionContext.commitmentRounds).toEqual(result.committed.commitmentRounds);
    expect(verifierContext.commitmentRounds).toEqual(result.committed.commitmentRounds);
    expect(resultStep(committedResult, "amount").aggregate).toBeGreaterThanOrEqual(4);
    expect(resultStep(committedResult, "amount").aggregate).toBeLessThanOrEqual(24);
    expect(() => validateSimulationState(result.state, true, true)).not.toThrow();

    const stateWithRandomRoundSize = (requestCount: number) => {
      const candidate = structuredClone(result.state);
      const step = candidate.history[0];
      const playerAction = step.actions.find((action) => action.actorId === "player")!;
      const playerOutcome = step.outcomes.find((outcome) => outcome.proposalId === playerAction.id)!;
      const requests = Array.from({ length: requestCount }, (_, index) => {
        const randomRequest = request(`round-cap-${index + 1}`, distribution("four-six-sum"));
        randomRequest.causes = [{ kind: "action", id: playerAction.id }];
        return randomRequest;
      });
      const checkReplay = resolveD20Checks(step.rngBefore, step.checkRequests);
      const resolved = resolveDiscreteRandomRequests(checkReplay.rng, requests);
      step.randomRequests = requests;
      step.randomResults = resolved.results;
      step.commitmentRounds = [
        { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
        { kind: "random", requestIds: requests.map((randomRequest) => randomRequest.id) },
      ];
      step.rngAfter = resolved.rng;
      candidate.truth.rng = structuredClone(resolved.rng);
      playerOutcome.causeRefs = [
        { kind: "action", id: playerAction.id },
        ...requests.map((randomRequest) => ({ kind: "random" as const, id: randomRequest.id })),
      ];
      playerOutcome.assertions = resolved.results.map((randomResult) => ({
        kind: "random_result" as const,
        requestId: randomResult.requestId,
        stepId: "amount",
        expected: resultStep(randomResult, "amount").aggregate!,
      }));
      const replayProposal: TransitionProposal = {
        baseRevision: step.baseRevision,
        outcomes: structuredClone(step.outcomes),
        mechanicInvocations: structuredClone(step.mechanicInvocations),
        operations: structuredClone(step.operations),
        events: structuredClone(step.events),
        observations: step.observations
          .filter((observation) => observation.kind === "outcome")
          .map((observation) => structuredClone(observation)),
        intentStatus: step.intentStatus,
        requiresPlayerDecision: step.requiresPlayerDecision,
      };
      step.causalAssertionResults = evaluateProposalCausality(
        stateBeforeStep,
        step.checks,
        resolved.results,
        replayProposal,
      );
      refreshCommittedStepHash(step);
      return candidate;
    };
    const atRandomRoundLimit = stateWithRandomRoundSize(MAX_RANDOM_REQUESTS_PER_ROUND);
    expect(() => validateSimulationState(atRandomRoundLimit, true, true)).not.toThrow();
    const aboveRandomRoundLimit = stateWithRandomRoundSize(MAX_RANDOM_REQUESTS_PER_ROUND + 1);
    expect(() => validateSimulationState(aboveRandomRoundLimit, true, true))
      .toThrow("invalid commitment round ledger");
    const roundOrderTampered = structuredClone(atRandomRoundLimit);
    const roundOrderStep = roundOrderTampered.history[0];
    roundOrderStep.commitmentRounds[1].requestIds.reverse();
    refreshCommittedStepHash(roundOrderStep);
    expect(() => validateSimulationState(roundOrderTampered, true, true))
      .toThrow("commitment rounds do not exactly cover requests in order");

    const intent = result.state.player.intent!;
    const sessionDocument: WorldSessionDocument = {
      schemaVersion: 8,
      id: "committed-random-session",
      world: toWorldRuntimeContract(definition),
      title: definition.name,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:01.000Z",
      state: result.state,
      runs: {
        "random-run": {
          id: "random-run",
          sessionId: "committed-random-session",
          intentId: intent.id,
          status: "completed",
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:01.000Z",
          cancelRequested: false,
          events: [{
            sequence: 1,
            type: "player.input",
            at: "2026-08-24T00:00:00.000Z",
            payload: {
              id: intent.latestInput.id,
              kind: intent.latestInput.kind,
              text: intent.latestInput.text,
            },
          }, {
            sequence: 2,
            type: "run.execution_started",
            at: "2026-08-24T00:00:00.000Z",
            payload: { runId: "random-run", inputId: intent.latestInput.id, reason: "initial" },
          }, {
            sequence: 3,
            type: "step.committed",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              revision: result.state.revision,
              step: result.state.step,
              elapsedSeconds: result.state.truth.elapsedSeconds,
            },
          }, {
            sequence: 4,
            type: "run.completed",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              runId: "random-run",
              revision: result.state.revision,
              step: result.state.step,
            },
          }],
        },
      },
    };
    const store = new MemoryWorldSessionStore();
    const stored = store.create(sessionDocument);
    const atLimitDocument = structuredClone(sessionDocument);
    atLimitDocument.state = atRandomRoundLimit;
    expect(() => new MemoryWorldSessionStore().create(atLimitDocument)).not.toThrow();
    const aboveLimitDocument = structuredClone(sessionDocument);
    aboveLimitDocument.state = aboveRandomRoundLimit;
    expect(() => new MemoryWorldSessionStore().create(aboveLimitDocument))
      .toThrow("invalid commitment round ledger");
    expect(stored.document.state.history[0].randomRequests[0].distribution)
      .toEqual(stored.document.world.randomDistributions[0]);
    const mismatched = structuredClone(stored.document);
    mismatched.world.randomDistributions[0].description = "tampered distribution";
    expect(() => store.compareAndSwap(mismatched.id, stored.generation, mismatched))
      .toThrow("session random distribution mismatch");

    const baselineTampered = structuredClone(stored.document);
    baselineTampered.world.historyBaseHash = "0".repeat(64);
    expect(() => store.compareAndSwap(baselineTampered.id, stored.generation, baselineTampered))
      .toThrow("session history replay base mismatch");

    const oversizedResult = structuredClone(stored.document);
    const oversizedStep = oversizedResult.state.history[0];
    oversizedStep.randomResults[0].steps[0].draws[0].value =
      "x".repeat(MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP);
    const oversizedPayload = { ...oversizedStep };
    delete (oversizedPayload as Partial<typeof oversizedStep>).contentHash;
    oversizedStep.contentHash = contentHash(oversizedPayload);
    expect(() => store.compareAndSwap(oversizedResult.id, stored.generation, oversizedResult))
      .toThrow("result byte limit");

    const tampered = structuredClone(result.state);
    const tamperedStep = tampered.history[0];
    const tamperedAmount = resultStep(tamperedStep.randomResults[0], "amount");
    tamperedAmount.aggregate = Number(tamperedAmount.aggregate) + 1;
    const tamperedPayload = { ...tamperedStep };
    delete (tamperedPayload as Partial<typeof tamperedStep>).contentHash;
    tamperedStep.contentHash = contentHash(tamperedPayload);
    expect(() => validateSimulationState(tampered, true, true)).toThrow("non-reproducible RNG audit");

    const observedTampered = structuredClone(result.state);
    const observedTamperedStep = observedTampered.history[0];
    const observedAssertion = observedTamperedStep.causalAssertionResults.find((candidate) =>
      candidate.target.kind === "outcome" && candidate.assertion.kind === "random_result");
    if (!observedAssertion || observedAssertion.assertion.kind !== "random_result") {
      throw new Error("missing stored random causal assertion result");
    }
    observedAssertion.observed = Number(observedAssertion.observed) + 1;
    refreshCommittedStepHash(observedTamperedStep);
    expect(() => validateSimulationState(observedTampered, true, true))
      .toThrow("invalid causal assurance");

    const passedTampered = structuredClone(result.state);
    const passedTamperedStep = passedTampered.history[0];
    const passedAssertion = passedTamperedStep.causalAssertionResults.find((candidate) =>
      candidate.target.kind === "outcome" && candidate.assertion.kind === "random_result");
    if (!passedAssertion || passedAssertion.assertion.kind !== "random_result") {
      throw new Error("missing stored random causal assertion result");
    }
    passedAssertion.passed = false;
    refreshCommittedStepHash(passedTamperedStep);
    expect(() => validateSimulationState(passedTampered, true, true))
      .toThrow("invalid causal assurance");

    const fiveRoundChain = structuredClone(result.state);
    const fiveRoundStep = fiveRoundChain.history[0];
    const chainRequests = Array.from({ length: 5 }, (_, index) => {
      const id = index === 0 ? "committed-yield" : `history-chain-${index + 1}`;
      const chained = request(id, distribution("four-six-sum"));
      chained.causes = index === 0
        ? structuredClone(fiveRoundStep.randomRequests[0].causes)
        : [{ kind: "random", id: index === 1 ? "committed-yield" : `history-chain-${index}` }];
      return chained;
    });
    const chainCheckReplay = resolveD20Checks(fiveRoundStep.rngBefore, fiveRoundStep.checkRequests);
    const chainResolution = resolveDiscreteRandomRequests(chainCheckReplay.rng, chainRequests);
    fiveRoundStep.randomRequests = chainRequests;
    fiveRoundStep.randomResults = chainResolution.results;
    fiveRoundStep.commitmentRounds = [
      { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
      ...chainRequests.map((chainRequest) => ({
        kind: "random" as const,
        requestIds: [chainRequest.id],
      })),
    ];
    fiveRoundStep.rngAfter = chainResolution.rng;
    fiveRoundChain.truth.rng = structuredClone(chainResolution.rng);
    refreshCommittedStepHash(fiveRoundStep);
    expect(() => validateSimulationState(fiveRoundChain, true, true))
      .toThrow("invalid commitment round ledger");

    const selfDependent = structuredClone(result.state);
    const selfDependentStep = selfDependent.history[0];
    selfDependentStep.randomRequests[0].causes = [{ kind: "random", id: "committed-yield" }];
    refreshCommittedStepHash(selfDependentStep);
    expect(() => validateSimulationState(selfDependent, true, true))
      .toThrow("history random request committed-yield references unknown random committed-yield");

    const randomBeforeCheck = structuredClone(result.state);
    const randomBeforeCheckStep = randomBeforeCheck.history[0];
    randomBeforeCheckStep.commitmentRounds = [
      { kind: "random", requestIds: ["committed-yield"] },
      { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
    ];
    refreshCommittedStepHash(randomBeforeCheckStep);
    expect(() => validateSimulationState(randomBeforeCheck, true, true))
      .toThrow("has a d20 round after random commitments");

    const perceptionAfterResolution = structuredClone(result.state);
    const perceptionAfterResolutionStep = perceptionAfterResolution.history[0];
    const latePerceptionRequest = structuredClone(perceptionAfterResolutionStep.checkRequests[0]);
    latePerceptionRequest.id = "late-perception-check";
    latePerceptionRequest.phase = "perception";
    perceptionAfterResolutionStep.checkRequests.push(latePerceptionRequest);
    perceptionAfterResolutionStep.checks = resolveD20Checks(
      perceptionAfterResolutionStep.rngBefore,
      perceptionAfterResolutionStep.checkRequests,
    ).results;
    perceptionAfterResolutionStep.commitmentRounds = [
      { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
      { kind: "check", phase: "perception", requestIds: ["late-perception-check"] },
      { kind: "random", requestIds: ["committed-yield"] },
    ];
    refreshCommittedStepHash(perceptionAfterResolutionStep);
    expect(() => validateSimulationState(perceptionAfterResolution, true, true))
      .toThrow("reopens perception after resolution");

    const siblingDependent = structuredClone(result.state);
    const siblingDependentStep = siblingDependent.history[0];
    const siblingRequest = request("sibling-history-draw", distribution("four-six-sum"));
    siblingRequest.causes = [{ kind: "random", id: "committed-yield" }];
    siblingDependentStep.randomRequests.push(siblingRequest);
    const siblingCheckReplay = resolveD20Checks(
      siblingDependentStep.rngBefore,
      siblingDependentStep.checkRequests,
    );
    const siblingResolution = resolveDiscreteRandomRequests(
      siblingCheckReplay.rng,
      siblingDependentStep.randomRequests,
    );
    siblingDependentStep.randomResults = siblingResolution.results;
    siblingDependentStep.commitmentRounds = [
      { kind: "check", phase: "resolution", requestIds: ["committed-check"] },
      {
        kind: "random",
        requestIds: siblingDependentStep.randomRequests.map((randomRequest) => randomRequest.id),
      },
    ];
    siblingDependentStep.rngAfter = siblingResolution.rng;
    siblingDependent.truth.rng = structuredClone(siblingResolution.rng);
    refreshCommittedStepHash(siblingDependentStep);
    expect(() => validateSimulationState(siblingDependent, true, true))
      .toThrow("history random request sibling-history-draw references unknown random committed-yield");

    const unusedCommitment = structuredClone(result.state);
    const unusedStep = unusedCommitment.history[0];
    const unusedRequest = request("unused-history-draw", distribution("four-six-sum"));
    const unusedResolution = resolveDiscreteRandomRequests(unusedStep.rngAfter, [unusedRequest]);
    unusedStep.randomRequests.push(unusedRequest);
    unusedStep.randomResults.push(...unusedResolution.results);
    unusedStep.commitmentRounds.push({ kind: "random", requestIds: [unusedRequest.id] });
    unusedStep.rngAfter = unusedResolution.rng;
    unusedCommitment.truth.rng = structuredClone(unusedResolution.rng);
    const unusedPayload = { ...unusedStep };
    delete (unusedPayload as Partial<typeof unusedStep>).contentHash;
    unusedStep.contentHash = contentHash(unusedPayload);
    expect(() => validateSimulationState(unusedCommitment, true, true))
      .toThrow("does not consume committed random unused-history-draw");

    engine.beginPlayerIntent("触发第二次世界声明的随机产出");
    const secondResult = await engine.step();
    expect(secondResult.committed.commitmentRounds).toEqual([
      { kind: "check", phase: "resolution", requestIds: ["committed-check:2"] },
      { kind: "random", requestIds: ["committed-yield:2"] },
    ]);
    expect(() => validateSimulationState(secondResult.state, true, true)).not.toThrow();
    const secondTransitionContext = provider.requests.findLast((modelRequest) =>
      modelRequest.role === "truth-transition")!.context as {
      semanticHistory: Array<{ commitmentRounds: unknown }>;
    };
    expect(secondTransitionContext.semanticHistory[0].commitmentRounds)
      .toEqual(result.committed.commitmentRounds);

    const priorRandomDependent = structuredClone(secondResult.state);
    const priorRandomStep = priorRandomDependent.history[1];
    priorRandomStep.randomRequests[0].causes = [{ kind: "random", id: "committed-yield" }];
    refreshCommittedStepHash(priorRandomStep);
    expect(() => validateSimulationState(priorRandomDependent, true, true))
      .toThrow("history random request committed-yield:2 references unknown random committed-yield");

    const priorCheckDependent = structuredClone(secondResult.state);
    const priorCheckStep = priorCheckDependent.history[1];
    priorCheckStep.randomRequests[0].causes = [{ kind: "check", id: "committed-check" }];
    refreshCommittedStepHash(priorCheckStep);
    expect(() => validateSimulationState(priorCheckDependent, true, true))
      .toThrow("history random request committed-yield:2 references unknown check committed-check");
  });

  it("rolls back when resolution requests a d20 round after random has started", async () => {
    const definition = fixtureWorld(103);
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        agent?: { id: string };
        jointActions?: Array<{ id: string; actorId: string }>;
        randomResults?: DiscreteRandomResult[];
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        const agentId = context.agent!.id;
        return {
          beliefPatch: { agentId, baseRevision: context.revision, operations: [] },
          characterPatch: { agentId, baseRevision: context.revision, operations: [] },
          nextAction: {
            id: `next:${agentId}:${context.revision}`,
            actorId: agentId,
            baseRevision: context.revision,
            rawText: "继续履行自己的职责",
            goal: "履行职责",
            means: null,
            targetIds: [],
          },
        };
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        if (!context.randomResults?.length) {
          return {
            kind: "request_random",
            requests: [{
              id: "random-before-late-check",
              distributionId: "four-six-sum",
              causes: [{ kind: "action", id: playerAction.id }],
            }],
          };
        }
        return {
          kind: "request_checks",
          requests: [{
            id: "late-resolution-check",
            actorId: "player",
            targetId: null,
            ratingId: null,
            modifier: 0,
            modifierSources: [],
            dc: 0,
            mode: "normal",
            stakes: "随机已经开始后不得再追加 d20。",
            visibility: "hidden",
            phase: "resolution",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }
      throw new Error(`unexpected role ${role}`);
    }, catalog, false);
    const engine = new SimulationEngine(
      definition,
      new TruthEngine(provider, { repairAttempts: 0 }),
      new AgentMind(provider),
    );
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("先随机再请求 d20", "random-before-check");
    const snapshot = engine.snapshot;

    await expect(engine.step()).rejects.toThrow(
      "d20 checks cannot be requested after discrete random commitments",
    );
    expect(engine.snapshot).toEqual(snapshot);
  });

  it("rejects drawing twice and consuming only the preferred commitment", async () => {
    const definition = fixtureWorld(101);
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        baseRevision: number;
        step: number;
        agent?: { id: string };
        jointActions?: Array<{ id: string; actorId: string }>;
        agentEpistemics?: Record<string, unknown>;
        randomResults?: DiscreteRandomResult[];
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        const agentId = context.agent!.id;
        return {
          beliefPatch: { agentId, baseRevision: context.revision, operations: [] },
          characterPatch: { agentId, baseRevision: context.revision, operations: [] },
          nextAction: {
            id: `next:${agentId}:${context.revision}`,
            actorId: agentId,
            baseRevision: context.revision,
            rawText: "继续履行自己的职责",
            goal: "履行职责",
            means: null,
            targetIds: [],
          },
        };
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        if (!context.randomResults?.length) {
          return {
            kind: "request_random",
            requests: [{
              id: "selection-a",
              distributionId: "four-six-sum",
              causes: [{ kind: "action", id: playerAction.id }],
            }],
          };
        }
        if (context.randomResults.length === 1) {
          return {
            kind: "request_random",
            requests: [{
              id: "selection-b",
              distributionId: "four-six-sum",
              causes: [{ kind: "action", id: playerAction.id }],
            }],
          };
        }
        return { kind: "done" };
      }
      if (role === "truth-transition") {
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        const selected = resultStep(context.randomResults![1], "amount").aggregate;
        const nextStep = context.step + 1;
        const eventId = `event:selection:${nextStep}`;
        return {
          baseRevision: context.baseRevision,
          outcomes: context.jointActions!.map((action) => ({
            proposalId: action.id,
            status: action.actorId === "player" ? "succeeded" : "continuing",
            summary: "只采用第二次随机结果。",
            causeRefs: action.actorId === "player"
              ? [{ kind: "action", id: playerAction.id }, { kind: "random", id: "selection-b" }]
              : [{ kind: "action", id: action.id }],
            assertions: action.actorId === "player"
              ? [{
                kind: "random_result",
                requestId: "selection-b",
                stepId: "amount",
                expected: selected!,
              }]
              : [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
            knownAlternatives: [],
          })),
          mechanicInvocations: [],
          operations: [{
            kind: "advance_time",
            seconds: 1,
            causes: [{ kind: "law", id: "time-passes" }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 0 }],
          }],
          events: [{
            id: eventId,
            step: nextStep,
            description: "试图在两次相同抽取中事后挑选。",
            impact: "ordinary",
            causes: [{ kind: "law", id: "time-passes" }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 1 }],
          }],
          observations: ["player", ...Object.keys(context.agentEpistemics ?? {})].map((observerId) => ({
            id: `observation:selection:${observerId}:${nextStep}`,
            observerId,
            step: nextStep,
            kind: "outcome",
            summary: "你感知到自己的本地行动经过了一秒。",
            introductions: [],
            apparentClaims: [],
            sourceEventIds: [],
          })),
          intentStatus: "completed",
          requiresPlayerDecision: false,
        } satisfies TransitionProposal;
      }
      if (role === "causal-verifier") return { verdict: "accept", findings: [] };
      throw new Error(`unexpected role ${role}`);
    }, catalog, false);
    const engine = new SimulationEngine(
      definition,
      new TruthEngine(provider, { repairAttempts: 0 }),
      new AgentMind(provider),
    );
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("连续抽取直到得到偏好的结果", "selection-shopping");
    const snapshot = engine.snapshot;

    await expect(engine.step()).rejects.toThrow("does not consume committed random selection-a");
    expect(engine.snapshot).toEqual(snapshot);
  });
});
