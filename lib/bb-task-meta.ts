/** P-V9 / B-W7: BB task meta endpoint binding checks (mirrors fm-backend-wrap). */
export function validateBbTaskMeta(
  meta: Record<string, string>,
  taskId: string,
): { ok: true } | { ok: false; reason: string } {
  const backend = meta.backend ?? "tmux";
  if (backend !== "bb") {
    return { ok: false, reason: "not bb backend" };
  }
  const window = meta.window?.trim();
  const worktree = meta.worktree?.trim();
  const project = meta.project?.trim();
  const binding = meta.endpoint_task_id?.trim();
  if (!window || !worktree || !project) {
    return { ok: false, reason: "incomplete bb endpoint metadata" };
  }
  if (binding !== taskId) {
    return { ok: false, reason: "endpoint_task_id mismatch" };
  }
  return { ok: true };
}
