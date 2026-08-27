"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreateInstanceInput, PublicInstanceSummary, WorldSummary } from "../../shared/world-api";
import { worldApi } from "../lib/world-api-client";

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
    void Promise.all([worldApi.worlds(), worldApi.instances()]).then(([worldResult, instanceResult]) => {
      if (!active) return;
      setWorlds(worldResult.worlds);
      setInstances(instanceResult.instances);
      setError("");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
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
