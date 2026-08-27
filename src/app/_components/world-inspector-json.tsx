"use client";

import { ChevronRight, Copy, Layers2, ListCollapse } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import type { WorldInspectorRuntimeEventSummary } from "../../shared/world-inspector-api";
import { worldInspectorApi } from "../lib/world-inspector-api-client";

type ExpansionMode = "default" | "one" | "collapsed";
type JsonKind = "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";

function jsonKind(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "string";
}

function valuePreview(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === "object") return `{${Object.keys(value).length}}`;
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return String(value);
}

function serializedValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value, null, 2) ?? String(value);
}

function pathLabel(path: readonly (number | string)[]): string {
  return path.reduce<string>((current, segment, index) => {
    if (typeof segment === "number") return `${current}[${segment}]`;
    if (index === 0) return segment;
    return /^[A-Za-z_$][\w$]*$/.test(segment) ? `${current}.${segment}` : `${current}[${JSON.stringify(segment)}]`;
  }, "");
}

function followsErrorPath(path: readonly (number | string)[]): boolean {
  return path.some((segment) => typeof segment === "string" &&
    ["error", "cause", "message", "validationIssues", "validationIssueCodes"].includes(segment));
}

function isNarrativePath(path: readonly (number | string)[]): boolean {
  const name = path.at(-1);
  return typeof name === "string" &&
    ["description", "goal", "means", "narrative", "rawText", "reason", "stakes", "summary", "text"].includes(name);
}

function JsonCopyMenu({
  name,
  onCopyPath,
  onCopyValue,
}: {
  name: string;
  onCopyPath: () => void;
  onCopyValue: () => void;
}) {
  const triggerRef = useRef<HTMLElement>(null);
  const choose = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    action();
    event.currentTarget.closest("details")!.open = false;
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  return (
    <details
      className="cg-json-copy-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        triggerRef.current?.focus();
      }}
    >
      <summary aria-label={`复制 ${name}`} ref={triggerRef} title={`复制 ${name}`}><Copy aria-hidden="true" /></summary>
      <div className="cg-json-copy-menu__panel">
        <button onClick={(event) => choose(event, onCopyPath)} type="button">复制路径</button>
        <button onClick={(event) => choose(event, onCopyValue)} type="button">复制值</button>
      </div>
    </details>
  );
}

function JsonNode({
  depth,
  expansionMode,
  name,
  onCopy,
  path,
  value,
}: {
  depth: number;
  expansionMode: ExpansionMode;
  name: number | string;
  onCopy: (label: string, value: string) => void;
  path: Array<number | string>;
  value: unknown;
}) {
  const kind = jsonKind(value);
  const expandable = kind === "array" || kind === "object";
  const defaultOpen = depth === 0 || followsErrorPath(path);
  const [open, setOpen] = useState(
    expansionMode === "one" ? depth <= 1 : expansionMode === "collapsed" ? false : defaultOpen,
  );
  const [visibleCount, setVisibleCount] = useState(100);

  const copyPath = () => onCopy("已复制字段路径", pathLabel(path));
  const copyValue = () => onCopy("已复制字段值", serializedValue(value));
  const nameText = typeof name === "number" ? String(name) : name;
  if (!expandable) {
    const display = kind === "string" ? JSON.stringify(value) : valuePreview(value);
    return (
      <div
        className="cg-json-row"
        data-depth={depth}
        data-error-path={followsErrorPath(path) || undefined}
        data-narrative-path={isNarrativePath(path) || undefined}
      >
        <span className="cg-json-row__indent" aria-hidden="true" />
        <span className="cg-json-key" title={nameText}>{nameText}</span><span aria-hidden="true">:</span>
        <span className="cg-json-primitive" data-kind={kind} title={String(value)}>{display}</span>
        {depth > 0 && <JsonCopyMenu name={nameText} onCopyPath={copyPath} onCopyValue={copyValue} />}
      </div>
    );
  }

  const totalEntries = Array.isArray(value) ? value.length : Object.keys(value as object).length;
  const entries: ReadonlyArray<readonly [number | string, unknown]> = !open
    ? []
    : Array.isArray(value)
      ? Array.from({ length: Math.min(value.length, visibleCount) }, (_, index) => [index, value[index]] as const)
      : Object.entries(value as Record<string, unknown>).slice(0, visibleCount);
  return (
    <div className="cg-json-branch" data-depth={depth}>
      <details
        className="cg-json-node"
        data-copyable={depth > 0 || undefined}
        data-depth={depth}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        open={open}
      >
        <summary>
          <ChevronRight aria-hidden="true" className="cg-json-node__chevron" />
          <span className="cg-json-key" title={nameText}>{nameText}</span><span aria-hidden="true">:</span>
          <span className="cg-json-preview" data-kind={kind}>{valuePreview(value)}</span>
        </summary>
        {open && (
          <div className="cg-json-node__children">
            {entries.map(([key, entry]) => (
              <JsonNode
                depth={depth + 1}
                expansionMode={expansionMode}
                key={`${String(key)}:${depth}`}
                name={key}
                onCopy={onCopy}
                path={[...path, key]}
                value={entry}
              />
            ))}
            {visibleCount < totalEntries && (
              <button className="cg-json-show-more" onClick={() => setVisibleCount((count) => count + 100)} type="button">
                再显示 {Math.min(100, totalEntries - visibleCount)} 项
              </button>
            )}
          </div>
        )}
      </details>
      {depth > 0 && <JsonCopyMenu name={nameText} onCopyPath={copyPath} onCopyValue={copyValue} />}
    </div>
  );
}

export function JsonInspector({ label, value }: { label: string; value: unknown }) {
  const [expansionMode, setExpansionMode] = useState<ExpansionMode>("default");
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [announcement, setAnnouncement] = useState<{ id: number; message: string }>();
  const copy = (message: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setAnnouncement((current) => ({ id: (current?.id ?? 0) + 1, message }));
    }).catch(() => setAnnouncement((current) => ({
      id: (current?.id ?? 0) + 1,
      message: "复制失败，请重试",
    })));
  };
  const updateExpansion = (mode: ExpansionMode) => {
    setExpansionMode(mode);
    setCollapseVersion((version) => version + 1);
  };
  return (
    <section className="cg-json-inspector" aria-label={label}>
      <header className="cg-json-inspector__toolbar">
        <strong>{label}</strong>
        <span>
          <button onClick={() => updateExpansion("one")} type="button"><Layers2 aria-hidden="true" />展开一层</button>
          <button onClick={() => updateExpansion("collapsed")} type="button"><ListCollapse aria-hidden="true" />收起全部</button>
          <button onClick={() => copy("已复制完整对象", serializedValue(value))} type="button"><Copy aria-hidden="true" />复制对象</button>
        </span>
      </header>
      <div className="cg-json-inspector__tree">
        <JsonNode
          depth={0}
          expansionMode={expansionMode}
          key={`${expansionMode}:${collapseVersion}`}
          name="$"
          onCopy={copy}
          path={["$"]}
          value={value}
        />
      </div>
      <span className="cg-sr-only" key={announcement?.id} role="status">{announcement?.message}</span>
    </section>
  );
}

export function RuntimeEventPayload({
  event,
  instanceId,
}: {
  event: WorldInspectorRuntimeEventSummary;
  instanceId: string;
}) {
  const [payload, setPayload] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);
  const requestAttempted = useRef(false);
  const load = (retry = false) => {
    if (requestInFlight.current || payload !== undefined || (!retry && requestAttempted.current)) return;
    requestInFlight.current = true;
    requestAttempted.current = true;
    setLoading(true);
    setError("");
    void worldInspectorApi.runtimeEvent(instanceId, event.id).then((detail) => {
      setPayload(detail.event.payload);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "无法读取 payload。");
    }).finally(() => {
      requestInFlight.current = false;
      setLoading(false);
    });
  };
  if (!event.hasPayload) return null;
  return (
    <details className="cg-runtime-payload" onToggle={(toggle) => {
      if (toggle.currentTarget.open) load();
      else if (payload === undefined) requestAttempted.current = false;
    }}>
      <summary><ChevronRight aria-hidden="true" />payload <small>展开时读取</small></summary>
      {loading && <p role="status">正在读取 payload…</p>}
      {error && (
        <p role="alert">{error} <button onClick={() => load(true)} type="button">重新读取</button></p>
      )}
      {!loading && !error && payload !== undefined && <JsonInspector label="payload" value={payload} />}
    </details>
  );
}
