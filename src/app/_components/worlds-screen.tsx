"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Upload } from "lucide-react";
import type { WorldSummary } from "../../shared/world-api";
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { WorldApiError, worldApi } from "../lib/world-api-client";
import { ManagementShell } from "./management-shell";

export function WorldsScreen() {
  const router = useRouter();
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<File>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh(): Promise<void> {
    const result = await worldApi.worlds();
    setWorlds(result.worlds);
  }

  useEffect(() => {
    let active = true;
    void worldApi.worlds()
      .then((result) => { if (active) setWorlds(result.worlds); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function start(world: WorldSummary): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const detail = await worldApi.createSession(world.id);
      localStorage.setItem(CURRENT_SESSION_KEY, detail.summary.id);
      router.push(`/play/${encodeURIComponent(detail.summary.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  }

  async function importWorld(file: File, replace = false): Promise<void> {
    setLoading(true);
    setError("");
    try {
      await worldApi.importWorld(file, replace);
      setConflict(undefined);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (reason) {
      if (reason instanceof WorldApiError && reason.status === 409 && !replace) setConflict(file);
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ManagementShell eyebrow="INSTALLED WORLDS" title="选择世界" description="世界是可安装的剧本与规则；新游戏会从它创建一份完全独立的本地存档。">
      {error ? <p className="cg-alert" role="alert">{error}</p> : null}
      <section className="cg-import-panel" aria-labelledby="import-title">
        <div>
          <p className="cg-eyebrow">WORLD PACKAGE</p>
          <h2 id="import-title">导入新的世界</h2>
          <p>选择符合 schema v6 的 ZIP 世界包。内容会安装到本机，不会上传到云端。</p>
        </div>
        <label className="cg-file-button">
          <Upload aria-hidden="true" /> 导入世界 ZIP
          <input ref={fileRef} type="file" accept=".zip,application/zip" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importWorld(file);
          }} />
        </label>
        {conflict ? (
          <div className="cg-import-conflict" role="alert">
            <p>同名世界已经存在。覆盖会直接替换已安装剧本。</p>
            <button onClick={() => void importWorld(conflict, true)} type="button">覆盖并导入</button>
            <button className="cg-button--quiet" onClick={() => setConflict(undefined)} type="button">取消</button>
          </div>
        ) : null}
      </section>

      {loading ? <p className="cg-empty-state" aria-live="polite">正在准备世界…</p> : null}
      {!loading && worlds.length === 0 ? <p className="cg-empty-state">尚未安装任何世界。先导入一个世界包。</p> : null}
      <div className="cg-world-list">
        {worlds.map((world, index) => (
          <article className="cg-world" key={world.id}>
            <span className="cg-world__index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="cg-eyebrow">VERSION {world.version}</p>
              <h2>{world.name}</h2>
              <p>{world.description}</p>
            </div>
            <button disabled={loading} onClick={() => void start(world)} type="button">
              开始旅程 <ArrowRight aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
    </ManagementShell>
  );
}
