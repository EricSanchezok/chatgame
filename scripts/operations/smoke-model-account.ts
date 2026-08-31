import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadModelCatalog } from "../../src/engine/models/model-catalog";
import { createModelGateway } from "../../src/engine/models/model-gateway";
import { promptBundle } from "../../src/engine/prompts";
import { ModelRegistry } from "../../src/engine/models/model-registry";
import { createModelFetchResolver } from "../../src/engine/models/model-network";
import { MODEL_CONTEXT_CONTRACT_VERSION, modelRoleContract } from "../../src/engine/contracts/model-context";

function accountArgument(argv: readonly string[]): string {
  const index = argv.indexOf("--account");
  const accountId = index >= 0 ? argv[index + 1]?.trim() : undefined;
  if (!accountId) throw new Error("usage: npm run test:live:model -- --account <account-id>");
  return accountId;
}

async function main(): Promise<void> {
  const accountId = accountArgument(process.argv.slice(2));
  const catalog = loadModelCatalog(path.resolve(
    process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
  ));
  const account = catalog.account(accountId);
  if (!process.env[account.api_key_env]?.trim()) {
    throw new Error(`account ${accountId} requires ${account.api_key_env}`);
  }
  const profile = catalog.profileSummaries("agent-mind")
    .find((candidate) => candidate.accountId === accountId) ??
    catalog.profileSummaries().find((candidate) => candidate.accountId === accountId);
  if (!profile) throw new Error(`account ${accountId} has no configured model profile`);

  const dataRoot = mkdtempSync(path.join(tmpdir(), "livingworld-model-smoke-"));
  try {
    const prompt = promptBundle("model-smoke");
    const registry = new ModelRegistry(catalog, dataRoot, { minimumRefreshIntervalMs: 0 });
    const gateway = createModelGateway(catalog, process.env, {
      registry,
      fetchForAccount: createModelFetchResolver(process.env),
    });
    await gateway.assertProfilesAvailable([profile.id]);
    const result = await gateway.generateStructured({
      profileId: profile.id,
      workloadId: `live-smoke:${accountId}`,
      batchId: randomUUID(),
      correlation: { executionId: randomUUID() },
      role: profile.allowedRoles.includes("agent-mind") ? "agent-mind" : profile.allowedRoles[0]!,
      subjectId: `live-smoke:${accountId}`,
      promptVersion: prompt.version,
      schemaName: "live_smoke_output",
      system: prompt.system,
      userPrompt: prompt.userPrompt,
      context: {
        contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
        roleContract: modelRoleContract(profile.allowedRoles.includes("agent-mind") ? "agent-mind" : profile.allowedRoles[0]!),
        execution: {
          worldId: "live-smoke",
          instanceId: `live-smoke:${accountId}`,
          advanceId: randomUUID(),
          revision: 0,
          step: 0,
        },
        task: {
          assignment: { targetHandles: [], availableHandles: [], allowedProposalKinds: [] },
          constraints: ["Return ok=true and a brief provider-neutral message."],
        },
        state: { instruction: "Return ok=true and a brief provider-neutral message." },
        referenceCatalog: { version: 1, hash: "live-smoke-empty", candidates: [] },
        repair: null,
      },
      schema: z.strictObject({ ok: z.literal(true), message: z.string().min(1).max(200) }),
      runtimeIdentity: { worldHash: `sha256:${"0".repeat(64)}`, revision: 0 },
    });
    process.stdout.write(`${JSON.stringify({
      accountId: result.audit.accountId,
      providerId: result.audit.providerId,
      modelId: result.audit.modelId,
      registrySnapshotHash: result.audit.registrySnapshotHash,
      structuredOutputMode: result.audit.structuredOutputMode,
      result: result.value,
    }, null, 2)}\n`);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
