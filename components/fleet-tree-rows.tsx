import type { TreeNode } from "../lib/types";
import { cn } from "@/lib/utils";

function fsmColor(state: string): string {
  switch (state) {
    case "working":
      return "bg-blue-500";
    case "blocked":
      return "bg-amber-500";
    case "done":
      return "bg-emerald-500";
    case "error":
    case "stopped":
      return "bg-red-500";
    case "unknown":
      return "bg-purple-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function livenessPip(verdict: string | null): string | null {
  if (!verdict || verdict === "alive") return null;
  if (verdict === "ambiguous") return "bg-purple-400";
  return "bg-red-500";
}

export function StatusDot({
  fsmState,
  liveness,
}: {
  fsmState: string;
  liveness: string | null;
}) {
  const pip = livenessPip(liveness);
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      <span className={cn("size-2.5 rounded-full", fsmColor(fsmState))} />
      {pip ? (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-background",
            pip,
          )}
        />
      ) : null}
    </span>
  );
}

function RailRow({
  node,
  selectedThreadId,
  onSelect,
  depth = 0,
}: {
  node: TreeNode;
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  depth?: number;
}) {
  const selected = selectedThreadId === node.threadId;
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.threadId)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover",
          selected && "bg-state-hover",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <StatusDot fsmState={node.fsmState} liveness={node.liveness} />
        <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
        {node.role ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            {node.role}
          </span>
        ) : null}
        {node.kind === "secondmate" ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">lead</span>
        ) : null}
      </button>
      {node.children.map((child: TreeNode) => (
        <RailRow
          key={child.id}
          node={child}
          selectedThreadId={selectedThreadId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function FleetTreeRows({
  tree,
  selectedThreadId,
  onSelectThread,
}: {
  tree: TreeNode[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}) {
  return (
    <>
      {tree.map((node) => (
        <RailRow
          key={node.id}
          node={node}
          selectedThreadId={selectedThreadId}
          onSelect={onSelectThread}
        />
      ))}
    </>
  );
}
