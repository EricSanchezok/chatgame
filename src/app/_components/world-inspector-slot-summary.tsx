import type { WorldInspectorSlotRef } from "../../shared/world-inspector-api";

const PREVIEW_LIMIT = 3;

function slotLabel(slot: WorldInspectorSlotRef): string {
  return slot.agentId ?? slot.label ?? `slot ${slot.slot}`;
}

export function WorldInspectorSlotSummary({ slotRefs }: { slotRefs: readonly WorldInspectorSlotRef[] }) {
  const labels = slotRefs.map(slotLabel);
  if (labels.length === 0) {
    return <span className="cg-inspector-slot-summary">未解析 slot</span>;
  }

  const preview = labels.slice(0, PREVIEW_LIMIT);
  const remaining = labels.length - preview.length;
  return (
    <span className="cg-inspector-slot-summary">
      <span className="cg-inspector-slot-summary__preview">
        <strong>{labels.length} 个 slot</strong>
        <span aria-hidden="true"> · </span>
        {preview.join("、")}{remaining > 0 ? ` 等 ${remaining} 个` : ""}
      </span>
    </span>
  );
}
