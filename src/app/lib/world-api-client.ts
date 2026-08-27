import type {
  AdvanceWorldInput,
  ArrivalView,
  CreateParticipantInput,
  PublicInstanceDetail,
  PublicInstanceSummary,
  ReleaseParticipantInput,
  SubmitExternalActionInput,
  WorldSummary,
} from "../../shared/world-api";
import { requestJson } from "./api-client";

export { WorldApiError } from "./api-client";

function body(method: "POST" | "PUT" | "PATCH", value: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

export const worldApi = {
  worlds: () => requestJson<{ worlds: WorldSummary[] }>("/api/worlds"),
  instances: () => requestJson<{ instances: PublicInstanceSummary[] }>("/api/instances"),
  createInstance: (worldId: string, seed?: number) =>
    requestJson<PublicInstanceDetail>("/api/instances", body("POST", { worldId, seed })),
  instance: (id: string) => requestJson<PublicInstanceDetail>(`/api/instances/${encodeURIComponent(id)}`),
  renameInstance: (id: string, title: string) =>
    requestJson<PublicInstanceDetail>(`/api/instances/${encodeURIComponent(id)}`, body("PATCH", { title })),
  deleteInstance: (id: string) =>
    requestJson<void>(`/api/instances/${encodeURIComponent(id)}`, { method: "DELETE" }),
  advance: (id: string, input: AdvanceWorldInput) =>
    requestJson<PublicInstanceDetail>(`/api/instances/${encodeURIComponent(id)}/advance`, body("POST", input)),
  realtime: (id: string, enabled: boolean) =>
    requestJson<PublicInstanceDetail>(`/api/instances/${encodeURIComponent(id)}/realtime`, body("PUT", { enabled })),
  createParticipant: (id: string, input: CreateParticipantInput) =>
    requestJson<{ instance: PublicInstanceDetail; participantId: string; arrival: ArrivalView }>(
      `/api/instances/${encodeURIComponent(id)}/participants`,
      body("POST", input),
    ),
  submitAction: (id: string, participantId: string, input: SubmitExternalActionInput) =>
    requestJson<PublicInstanceDetail>(
      `/api/instances/${encodeURIComponent(id)}/participants/${encodeURIComponent(participantId)}/actions`,
      body("POST", input),
    ),
  releaseParticipant: (id: string, participantId: string, input: ReleaseParticipantInput) =>
    requestJson<PublicInstanceDetail>(
      `/api/instances/${encodeURIComponent(id)}/participants/${encodeURIComponent(participantId)}/release`,
      body("POST", input),
    ),
  importWorld: (file: File, options: { replace?: boolean; expectedWorldId?: string } = {}) => {
    const form = new FormData();
    form.set("file", file);
    form.set("replace", String(options.replace === true));
    if (options.expectedWorldId) form.set("expectedWorldId", options.expectedWorldId);
    return requestJson<{ id: string; name: string; description: string; replaced: boolean }>(
      "/api/worlds/import",
      { method: "POST", body: form },
    );
  },
  deleteWorld: (worldId: string) =>
    requestJson<void>(`/api/worlds/${encodeURIComponent(worldId)}`, { method: "DELETE" }),
};
