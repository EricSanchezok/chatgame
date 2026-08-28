"use client";

import { useEffect, useState } from "react";
import type {
  ModelRegistryDiagnostics,
  ModelRegistryRefreshDiagnostics,
} from "../../engine/model-provider";

type LoadState = "loading" | "ready" | "error";

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

const healthCopy: Record<ModelRegistryDiagnostics["registry"]["health"], string> = {
  missing: "模型目录尚未就绪",
  fresh: "模型目录可用",
  stale: "模型目录已过期",
  refreshing: "正在刷新模型目录",
  degraded: "刷新失败，正在使用上次可用目录",
};

const channelCopy = {
  api: "API",
  "coding-plan": "Coding Plan",
  "token-plan": "Token Plan",
} as const;

export function ModelRegistrySettings() {
  const [diagnostics, setDiagnostics] = useState<ModelRegistryDiagnostics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState("正在读取模型目录状态。");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/model-registry", { signal: controller.signal, cache: "no-store" })
      .then((response) => responseJson<ModelRegistryDiagnostics>(response))
      .then((next) => {
        setDiagnostics(next);
        setLoadState("ready");
        setAnnouncement(healthCopy[next.registry.health]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadState("error");
        setAnnouncement(error instanceof Error ? error.message : "无法读取模型目录状态。");
      });
    return () => controller.abort();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    setAnnouncement("正在刷新模型目录。");
    try {
      const response = await fetch("/api/model-registry/refresh", { method: "POST" });
      const result = await responseJson<ModelRegistryRefreshDiagnostics>(response);
      setDiagnostics(result.diagnostics);
      setLoadState("ready");
      setAnnouncement(result.outcome === "stale-fallback"
        ? "刷新失败，已继续使用上次可用目录。"
        : result.outcome === "not-modified" || result.outcome === "unchanged"
          ? "模型目录已检查，没有发现变化。"
          : "模型目录已更新；新的世界执行会使用新快照。");
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "模型目录刷新失败。");
    } finally {
      setRefreshing(false);
    }
  };

  const configuredAccounts = diagnostics?.accounts.filter((account) =>
    account.credentialConfigured).length ?? 0;
  const unresolvedProfiles = diagnostics?.profiles.filter((profile) =>
    profile.resolutionError !== null).length ?? 0;
  const checkedAt = diagnostics?.registry.checkedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(diagnostics.registry.checkedAt))
    : "尚未成功检查";

  return (
    <section
      aria-busy={loadState === "loading" || refreshing}
      aria-labelledby="settings-model-provider-title"
      className="cg-settings__group cg-model-registry"
    >
      <header className="cg-model-registry__header">
        <div>
          <h3 id="settings-model-provider-title">模型供应商</h3>
          <p>只读显示本机账户、目录快照和 profile 解析结果。密钥仍由环境变量管理，不会在这里显示。</p>
        </div>
        <button
          aria-busy={refreshing}
          className="cg-button--quiet"
          disabled={refreshing || loadState === "loading"}
          onClick={() => void refresh()}
          type="button"
        >
          {refreshing ? "正在刷新…" : "刷新模型目录"}
        </button>
      </header>

      <p aria-atomic="true" aria-live="polite" className="cg-model-registry__announcement" role="status">
        {announcement}
      </p>

      {diagnostics ? (
        <>
          <dl className="cg-model-registry__summary">
            <div>
              <dt>目录状态</dt>
              <dd data-health={diagnostics.registry.health}>{healthCopy[diagnostics.registry.health]}</dd>
            </div>
            <div>
              <dt>最近检查</dt>
              <dd>{checkedAt}</dd>
            </div>
            <div>
              <dt>账户凭证</dt>
              <dd>{configuredAccounts} / {diagnostics.accounts.length} 已配置</dd>
            </div>
            <div>
              <dt>Profile 解析</dt>
              <dd>{unresolvedProfiles === 0 ? "全部可解析" : `${unresolvedProfiles} 个不可解析`}</dd>
            </div>
          </dl>
          {diagnostics.registry.currentHash ? (
            <p className="cg-model-registry__snapshot">
              当前快照 <code>{diagnostics.registry.currentHash.slice(0, 12)}</code>
            </p>
          ) : null}

          <ul aria-label="模型账户" className="cg-model-registry__accounts">
            {diagnostics.accounts.map((account) => (
              <li key={account.id}>
                <div>
                  <strong>{account.id}</strong>
                  <small>{channelCopy[account.channel]} · {account.protocol} · {account.region}</small>
                </div>
                <span data-configured={account.credentialConfigured}>
                  {account.credentialConfigured ? "凭证已配置" : "凭证未配置"}
                </span>
              </li>
            ))}
          </ul>

          <details className="cg-model-registry__profiles">
            <summary>查看 {diagnostics.profiles.length} 个 Profile 的解析结果</summary>
            <ul>
              {diagnostics.profiles.map((profile) => (
                <li key={profile.id}>
                  <div>
                    <strong>{profile.id}</strong>
                    <small>{profile.accountId}</small>
                  </div>
                  <span>
                    {profile.resolvedModelId ?? profile.resolutionError ?? "尚未解析"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : loadState === "error" ? (
        <p className="cg-alert">无法读取模型供应商状态。世界数据不会因此被修改。</p>
      ) : null}
    </section>
  );
}
