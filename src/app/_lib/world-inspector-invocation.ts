export type WorldInspectorInvocationIdentity = {
  id: string;
  executionId?: string;
};

/**
 * Query results carry executionId explicitly; step and attempt projections only
 * carry the canonical public id, whose first segment is the execution id.
 */
export function worldInspectorInvocationExecutionId(
  invocation: WorldInspectorInvocationIdentity,
): string | undefined {
  if (invocation.executionId) return invocation.executionId;
  const separator = invocation.id.indexOf("::");
  return separator > 0 ? invocation.id.slice(0, separator) : undefined;
}

export function worldInspectorInvocationExecutionHint(
  invocation: WorldInspectorInvocationIdentity,
): string | undefined {
  return worldInspectorInvocationExecutionId(invocation)?.slice(0, 8);
}
