"use client";

import { Component, createElement, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import {
  useScriptRegistry,
  type SlotId,
  type SlotProps,
} from "../../lib/script-registry";

class ScriptSlotErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; slot: SlotId },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Script UI slot "${this.props.slot}" failed`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function SlotRenderer<K extends SlotId>({
  slot,
  fallback: Fallback,
  slotProps,
  scriptWrapper,
}: {
  slot: K;
  fallback: ComponentType<SlotProps<K>>;
  slotProps: SlotProps<K>;
  scriptWrapper?: (node: ReactNode) => ReactNode;
}) {
  const registry = useScriptRegistry();
  const definition = registry.slots.get(slot) as { component: ComponentType<SlotProps<K>> } | undefined;
  const FallbackComponent = Fallback as unknown as ComponentType<Record<string, unknown>>;
  const props = slotProps as unknown as Record<string, unknown>;
  if (!definition) return createElement(FallbackComponent, props);
  const ScriptComponent = definition.component as unknown as ComponentType<Record<string, unknown>>;
  const fallback = createElement(FallbackComponent, props);
  const scriptNode = createElement(ScriptComponent, props);
  return (
    <ScriptSlotErrorBoundary
      key={`${registry.generation}:${slot}`}
      slot={slot}
      fallback={fallback}
    >
      {scriptWrapper ? scriptWrapper(scriptNode) : scriptNode}
    </ScriptSlotErrorBoundary>
  );
}
