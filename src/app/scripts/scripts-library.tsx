"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Badge, Button, Checkbox, Input } from "@/shared/ui-runtime";
import { httpGamePort, type ImportPreview, type ScriptDetail, type ScriptSummary } from "../lib/api";
import { patchPlayerSettings, readPlayerSettings } from "../lib/settings";
import { applyHostTheme } from "../lib/theme";
import { Dialog } from "../ui/dialog";
import { HostAppShell } from "../ui/host-app-shell";

function codeRisk(preview: ImportPreview): boolean {
  return preview.risks.some((risk) => risk.code === "engine-code" || risk.code === "ui-code");
}

export function ScriptsLibrary() {
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScriptSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在读取剧本库……");
  const [hasError, setHasError] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function refresh(preferId?: string) {
    const result = await httpGamePort.listScripts();
    setScripts(result.scripts);
    const stored = readPlayerSettings().activeScriptId;
    const nextId = preferId ?? selectedId ?? stored ?? result.scripts[0]?.id ?? null;
    setSelectedId(result.scripts.some((script) => script.id === nextId) ? nextId : result.scripts[0]?.id ?? null);
    setStatus(result.scripts.length > 0 ? `已安装 ${result.scripts.length} 个剧本。` : "剧本库为空。可导入 zip 剧本。 ");
    setHasError(false);
  }

  useEffect(() => {
    applyHostTheme();
    queueMicrotask(() => {
      void refresh().catch((error) => {
        setStatus(`读取失败：${error instanceof Error ? error.message : String(error)}。请重试。`);
        setHasError(true);
      });
    });
    // The initial library fetch is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const controller = new AbortController();
    void httpGamePort.scriptDetail(selectedId, controller.signal)
      .then(setDetail)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setStatus(`档案读取失败：${error instanceof Error ? error.message : String(error)}`);
          setHasError(true);
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("zh-CN");
    if (!term) return scripts;
    return scripts.filter((script) =>
      [script.name, script.id, script.author, script.description, ...script.tone]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(term),
    );
  }, [query, scripts]);
  const selected = scripts.find((script) => script.id === selectedId) ?? null;
  const selectedDetail = detail?.scriptId === selectedId ? detail : null;
  const currentId = readPlayerSettings().activeScriptId;

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setRiskConfirmed(false);
    setReplaceConfirmed(false);
    setStatus(`正在检查 ${file.name}……`);
    try {
      const next = await httpGamePort.previewImport(file);
      setPreview(next);
      setStatus(next.errors.length > 0
        ? `《${next.name}》有 ${next.errors.length} 个错误，尚不能安装。`
        : `已完成《${next.name}》的静态检查，尚未安装。`);
    } catch (error) {
      setStatus(`无法预览：${error instanceof Error ? error.message : String(error)}。请选择修正后的 zip。`);
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await httpGamePort.commitImport(preview.token, replaceConfirmed);
      setPreview(null);
      patchPlayerSettings({ activeScriptId: result.scriptId });
      await refresh(result.scriptId);
      setStatus(`《${preview.name}》已安装并设为当前剧本。${result.warnings.length ? `仍有 ${result.warnings.length} 条提示。` : ""}`);
    } catch (error) {
      setStatus(`安装失败：${error instanceof Error ? error.message : String(error)}。请重新选择 zip 后再试。`);
      setHasError(true);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeScript() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await httpGamePort.deleteScript(deleteTarget.id);
      if (readPlayerSettings().activeScriptId === deleteTarget.id) patchPlayerSettings({ activeScriptId: null });
      setDeleteTarget(null);
      await refresh();
      setStatus(`《${deleteTarget.name}》已删除；存档数据未删除。`);
    } catch (error) {
      setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`);
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HostAppShell active="scripts" script={selected ? { name: selected.name, description: selected.description } : null} status={status} statusVisible={hasError}>
      <div className="cg-library">
        <header className="cg-page-heading">
          <div>
            <h1>剧本库</h1>
            <p>浏览已安装剧目；导入前先检查内容、代码权限与替换风险。</p>
          </div>
          <Button type="button" variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "正在检查……" : "导入 zip"}
          </Button>
          <input
            ref={fileRef}
            className="cg-sr-only"
            type="file"
            accept=".zip,application/zip"
            aria-label="选择要导入的剧本 zip 文件"
            onChange={(event) => void chooseFile(event)}
          />
        </header>

        <label className="cg-search" htmlFor="script-search">
          <span>搜索档案</span>
          <Input id="script-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、作者或题材" />
        </label>

        <div className="cg-library__body">
          <ol className="cg-dossier-list" aria-label="已安装剧本">
            {filtered.map((script) => (
              <li key={script.id}>
                <button
                  type="button"
                  className="cg-dossier-row"
                  aria-pressed={script.id === selectedId}
                  onClick={() => setSelectedId(script.id)}
                >
                  {script.cover?.file ? (
                    // eslint-disable-next-line @next/next/no-img-element -- runtime local assets.
                    <img src={httpGamePort.assetUrl(script.id, script.cover.file)} alt="" />
                  ) : <span className="cg-dossier-row__fallback" aria-hidden="true">{script.name.slice(0, 1)}</span>}
                  <span className="cg-dossier-row__copy">
                    <strong>{script.name}</strong>
                    <span>{script.author} · 规格 {script.schemaVersion} · {script.source.label}</span>
                  </span>
                  {script.id === currentId ? <span className="cg-status-mark">当前</span> : null}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? <li className="cg-list-empty">没有匹配的剧本。清除搜索词，或导入新剧本。</li> : null}
          </ol>

          <section className="cg-dossier-detail" aria-live="polite">
            {selected && selectedDetail ? (
              <>
                <div className="cg-dossier-detail__cover">
                  {selected.cover?.file ? (
                    // eslint-disable-next-line @next/next/no-img-element -- runtime local assets.
                    <img src={httpGamePort.assetUrl(selected.id, selected.cover.file)} alt={selected.cover.alt ?? ""} />
                  ) : <span aria-hidden="true">{selected.name.slice(0, 1)}</span>}
                </div>
                <div className="cg-dossier-detail__title"><h2>{selected.name}</h2>{selected.id === currentId ? <Badge tone="accent">当前剧本</Badge> : null}</div>
                <p>{selected.description}</p>
                <dl>
                  <div><dt>出身</dt><dd>{selectedDetail.origins.length}</dd></div>
                  <div><dt>地点</dt><dd>{selectedDetail.catalog.locations.length}</dd></div>
                  <div><dt>存档</dt><dd>{selectedDetail.saves.length}</dd></div>
                  <div><dt>分级</dt><dd>{selectedDetail.safety.age_rating || "未标注"}</dd></div>
                  <div><dt>规格版本</dt><dd>{selected.schemaVersion}</dd></div>
                  <div><dt>来源</dt><dd>{selected.source.label}</dd></div>
                </dl>
                {selected.source.kind === "built-in" ? <p className="cg-dossier-detail__notice">内置剧本随应用更新，不能删除。</p> : <p className="cg-dossier-detail__notice">导入剧本由你管理；删除剧本不会同时删除存档。</p>}
                <footer className="cg-dossier-detail__actions">
                  {selected.id !== currentId ? <Button type="button" variant="primary" onClick={() => {
                    patchPlayerSettings({ activeScriptId: selected.id });
                    setStatus(`《${selected.name}》已设为当前剧本。返回游戏即可开始。`);
                    setHasError(false);
                    setScripts((items) => [...items]);
                  }}>设为当前剧本</Button> : <span className="cg-help">游戏首页将使用此剧本。</span>}
                  {selected.source.kind === "imported" ? <Button type="button" variant="danger" onClick={() => setDeleteTarget(selected)}>删除剧本</Button> : null}
                </footer>
              </>
            ) : <p className="cg-help">选择左侧档案查看完整信息。</p>}
          </section>
        </div>
      </div>

      {preview ? (
        <Dialog title="安装前检查" description={`${preview.sourceName} 已暂存；确认前不会安装或运行代码。`} onClose={() => setPreview(null)}>
          <div className="cg-import-preview">
            <div>
              {preview.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- opaque staged asset route, unavailable to next/image.
                <img className="cg-import-cover" src={preview.coverUrl} alt={preview.cover?.alt ?? `${preview.name}封面`} />
              ) : null}
              <h3>{preview.name}</h3>
              <p className="cg-help">剧本 ID：{preview.scriptId}</p>
              {preview.cover ? <p className="cg-help">封面：{preview.cover.alt ?? preview.cover.file ?? "已声明生成提示"}</p> : null}
            </div>
            <dl className="cg-import-facts">
              <div><dt>规格版本</dt><dd>{preview.schemaVersion ?? "无法识别"}</dd></div>
              <div><dt>UI API</dt><dd>{preview.apiVersions.scriptUi ?? "无 UI"} / 宿主 {preview.apiVersions.hostUi}</dd></div>
              <div><dt>引擎 API</dt><dd>{preview.apiVersions.engine ?? "无扩展"}</dd></div>
              <div><dt>能力</dt><dd>{preview.permissions.length ? preview.permissions.join("、") : "仅声明式内容"}</dd></div>
              <div><dt>冲突</dt><dd>{preview.conflicts.installed ? "已安装同 ID 剧本" : "无"}</dd></div>
              <div><dt>素材来源</dt><dd>{preview.assetProvenance.manifestPresent ? `${preview.assetProvenance.coveredFiles} / ${preview.assetProvenance.totalFiles} 已记录` : preview.assetProvenance.totalFiles > 0 ? "缺少来源清单" : "无本地素材"}</dd></div>
            </dl>
            {preview.assetProvenance.missingFiles.length > 0 ? <details><summary>{preview.assetProvenance.missingFiles.length} 个素材缺少来源</summary><ul>{preview.assetProvenance.missingFiles.map((file) => <li key={file}>{file}</li>)}</ul></details> : null}
            {preview.assetProvenance.extraFiles.length > 0 ? <details><summary>{preview.assetProvenance.extraFiles.length} 条多余来源记录</summary><ul>{preview.assetProvenance.extraFiles.map((file) => <li key={file}>{file}</li>)}</ul></details> : null}
            {preview.assetProvenance.remoteReferences.length > 0 ? <details><summary>{preview.assetProvenance.remoteReferences.length} 个远程热链</summary><ul>{preview.assetProvenance.remoteReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul></details> : null}
            {preview.errors.length > 0 ? (
              <section className="cg-risk-list" aria-labelledby="error-title"><h3 id="error-title">必须修复的错误</h3><ul>{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul></section>
            ) : null}
            {preview.risks.length > 0 ? (
              <section className="cg-risk-list" aria-labelledby="risk-title">
                <h3 id="risk-title">需要确认的风险</h3>
                {preview.risks.map((risk) => <div key={risk.code}><strong>{risk.label}</strong><p>{risk.detail}</p></div>)}
              </section>
            ) : null}
            {preview.warnings.length > 0 ? (
              <details><summary>{preview.warnings.length} 条校验提示</summary><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
            ) : null}
            {codeRisk(preview) ? (
              <div className="cg-confirmation"><Checkbox id="risk-confirmed" checked={riskConfirmed} onCheckedChange={setRiskConfirmed} /><label htmlFor="risk-confirmed">我信任此来源，并理解剧本包含会运行的代码。</label></div>
            ) : null}
            {preview.conflicts.installed && preview.conflicts.replaceAllowed ? (
              <div className="cg-confirmation"><Checkbox id="replace-confirmed" checked={replaceConfirmed} onCheckedChange={setReplaceConfirmed} /><label htmlFor="replace-confirmed">替换已安装的《{preview.name}》；旧剧本目录会被完整替换。</label></div>
            ) : null}
            <Button
              data-autofocus
              type="button"
              variant="danger"
              disabled={busy || preview.errors.length > 0 || (codeRisk(preview) && !riskConfirmed) || (preview.conflicts.replaceAllowed && !replaceConfirmed)}
              onClick={() => void commit()}
            >
              {busy ? "正在安装……" : preview.errors.length > 0 ? "无法安装" : preview.conflicts.replaceAllowed ? "确认替换" : "确认安装"}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog title={`删除《${deleteTarget.name}》`} description="剧本目录与已构建界面会被删除；存档保留。此操作无法在应用内撤销。" onClose={() => setDeleteTarget(null)}>
          <div className="cg-dialog-actions">
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button data-autofocus type="button" variant="danger" disabled={busy} onClick={() => void removeScript()}>{busy ? "正在删除……" : "确认删除剧本"}</Button>
          </div>
        </Dialog>
      ) : null}
    </HostAppShell>
  );
}
