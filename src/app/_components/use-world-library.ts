"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreateInstanceInput, PublicInstanceSummary, WorldSummary } from "../../shared/world-api";
import { WorldApiError, worldApi } from "../lib/world-api-client";

const INITIAL_LOAD_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

type WorldLibraryApi = Pick<typeof worldApi, "worlds" | "instances">;

interface LoadWorldLibraryOptions {
  api?: WorldLibraryApi;
  retryDelaysMs?: readonly number[];
  signal?: AbortSignal;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

function isRetryableLoadError(reason: unknown): boolean {
  if (reason instanceof WorldApiError) {
    return reason.status === 408 || reason.status === 429 || reason.status >= 500;
  }
  return reason instanceof TypeError;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function loadWorldLibrary({
  api = worldApi,
  retryDelaysMs = INITIAL_LOAD_RETRY_DELAYS_MS,
  signal,
  wait = waitForRetry,
}: LoadWorldLibraryOptions = {}): Promise<{
  worlds: WorldSummary[];
  instances: PublicInstanceSummary[];
}> {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const [worldResult, instanceResult] = await Promise.all([api.worlds(), api.instances()]);
      return { worlds: worldResult.worlds, instances: instanceResult.instances };
    } catch (reason) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined || !isRetryableLoadError(reason)) throw reason;
      await wait(delayMs, signal);
    }
  }
}

export function useWorldLibrary() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [instances, setInstances] = useState<PublicInstanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [worldResult, instanceResult] = await Promise.all([worldApi.worlds(), worldApi.instances()]);
      setWorlds(worldResult.worlds);
      setInstances(instanceResult.instances);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadWorldLibrary({ signal: controller.signal }).then(({ worlds: loadedWorlds, instances: loadedInstances }) => {
      if (!active) return;
      setWorlds(loadedWorlds);
      setInstances(loadedInstances);
      setError("");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const perform = useCallback(async <T,>(key: string, action: () => Promise<T>, message: string): Promise<T> => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(message);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(undefined);
    }
  }, []);

  return {
    worlds,
    instances,
    loading,
    busy,
    error,
    notice,
    refresh,
    createInstance: async (input: CreateInstanceInput) => {
      const created = await perform(
        `instance-create:${input.worldId}`,
        () => worldApi.createInstance(input),
        "新游戏已创建。",
      );
      await refresh();
      return created;
    },
    deleteInstance: async (instance: PublicInstanceSummary) => {
      await perform(`instance-delete:${instance.id}`, () => worldApi.deleteInstance(instance.id), "实例已删除。");
      await refresh();
    },
    renameInstance: async (instance: PublicInstanceSummary, title: string) => {
      await perform(`instance-rename:${instance.id}`, () => worldApi.renameInstance(instance.id, title), "实例名称已更新。");
      await refresh();
    },
    importWorld: async (file: File, options: { replace?: boolean; expectedWorldId?: string } = {}) => {
      const result = await perform(
        `world-import:${options.expectedWorldId ?? file.name}`,
        () => worldApi.importWorld(file, options),
        options.replace ? "世界包已更新。" : "世界包已导入。",
      );
      await refresh();
      return result;
    },
    deleteWorld: async (world: WorldSummary) => {
      await perform(`world-delete:${world.id}`, () => worldApi.deleteWorld(world.id), "世界包已卸载。");
      await refresh();
    },
  };
}
