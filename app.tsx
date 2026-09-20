import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  ThreadChat,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import type { Home, InboxItem, TreeNode } from "./lib/types";
import { FleetSettingsSection } from "@/components/fleet-settings";
import { HomesPanel } from "@/components/homes-panel";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const FLEET_CHANGED = "fleet-changed";

type Tab = "fleet" | "inbox" | "board" | "homes";

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

function StatusDot({
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

function BoardLane({
  title,
  nodes,
}: {
  title: string;
  nodes: TreeNode[];
}) {
  const flat: TreeNode[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      flat.push(item);
      walk(item.children);
    }
  };
  walk(nodes);
  const filtered = flat.filter((node) => {
    if (title === "Working") return node.fsmState === "working";
    if (title === "Blocked") return node.fsmState === "blocked";
    if (title === "Idle") return node.fsmState === "idle" || node.fsmState === "starting";
    if (title === "Done") return node.fsmState === "done";
    return ["error", "unknown", "stopped"].includes(node.fsmState);
  });
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-2">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {title} ({filtered.length})
      </div>
      <ul className="space-y-1">
        {filtered.map((node) => (
          <li
            key={node.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
          >
            <StatusDot fsmState={node.fsmState} liveness={node.liveness} />
            <span className="truncate">{node.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboxList({
  items,
  onOpen,
  onResolve,
}: {
  items: InboxItem[];
  onOpen: (threadId: string) => void;
  onResolve: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Fleet inbox is empty.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 px-3 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{item.title}</div>
            <div className="mt-0.5 text-muted-foreground">{item.body}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {item.kind} · {item.urgency}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" onClick={() => onOpen(item.threadId)}>
              Open
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolve(item.id)}>
              Resolve
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FleetPage({ subPath }: { subPath?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [homes, setHomes] = useState<Home[]>([]);
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [badge, setBadge] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fleet");
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc
      .call("listHomes", null)
      .then((result) => {
        setHomes(result.homes);
        setSelectedHomeId(result.selectedHomeId);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
    rpc.call("inboxBadge", null).then((result) => setBadge(result.count));
  }, [rpc]);

  const refetchHome = useCallback(
    (homeId: string | null) => {
      if (!homeId) {
        setTree([]);
        setInbox([]);
        return;
      }
      rpc.call("getTree", { homeId }).then((result) => setTree(result.tree));
      rpc
        .call("listInbox", { homeId, state: "open" })
        .then((result) => setInbox(result.items));
    },
    [rpc],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    refetchHome(selectedHomeId);
  }, [selectedHomeId, refetchHome]);

  useRealtime(FLEET_CHANGED, () => {
    refetch();
    refetchHome(selectedHomeId);
  });

  useEffect(() => {
    if (subPath?.startsWith("inbox")) setTab("inbox");
    else if (subPath?.startsWith("board")) setTab("board");
    else if (subPath?.startsWith("homes")) setTab("homes");
    else setTab("fleet");
    const threadMatch = subPath?.match(/^thread\/(.+)$/);
    if (threadMatch) setSelectedThreadId(threadMatch[1]);
  }, [subPath]);

  const openHolds = useMemo(
    () => inbox.filter((item) => item.kind === "hold"),
    [inbox],
  );

  const selectHome = async (homeId: string) => {
    await rpc.call("selectHome", { homeId });
    setSelectedHomeId(homeId);
    setSelectedThreadId(null);
  };

  const selectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setTab("fleet");
    navigate.toPluginPanel("fleet", { subPath: `thread/${threadId}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="Ship" className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Fleet</span>
        {badge > 0 ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
            {badge} inbox
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {homes.map((home) => (
            <Button
              key={home.homeId}
              size="sm"
              variant={selectedHomeId === home.homeId ? "secondary" : "ghost"}
              onClick={() => void selectHome(home.homeId)}
            >
              {home.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Manage mate homes"
            onClick={() => setTab("homes")}
          >
            <Icon name="Plus" className="size-4" />
          </Button>
        </div>
      </header>

      {openHolds.length > 0 ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          Needs decision: {openHolds[0]?.title}
          {openHolds.length > 1 ? ` (+${openHolds.length - 1})` : ""}
        </div>
      ) : null}

      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1">
        {(["fleet", "inbox", "board", "homes"] as Tab[]).map((name) => (
          <Button
            key={name}
            size="sm"
            variant={tab === name ? "secondary" : "ghost"}
            onClick={() => setTab(name)}
          >
            {name === "fleet"
              ? "Tree + Chat"
              : name === "inbox"
                ? "Inbox"
                : name === "board"
                  ? "Board"
                  : "Homes"}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {tab === "homes" ? (
        <HomesPanel
          homes={homes}
          selectedHomeId={selectedHomeId}
          onSelectHome={(homeId) => void selectHome(homeId)}
          onChanged={refetch}
        />
      ) : !selectedHomeId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <p>No mate home selected.</p>
          <Button size="sm" onClick={() => setTab("homes")}>
            Create or select a home
          </Button>
        </div>
      ) : tab === "inbox" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <InboxList
            items={inbox}
            onOpen={selectThread}
            onResolve={(id) => {
              rpc
                .call("resolveInbox", { homeId: selectedHomeId, id })
                .then(() => refetchHome(selectedHomeId));
            }}
          />
        </div>
      ) : tab === "board" ? (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
          {["Working", "Blocked", "Idle", "Done", "Failed|Unknown"].map((lane) => (
            <BoardLane key={lane} title={lane} nodes={tree} />
          ))}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-border p-2">
            {tree.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                No crews yet. Spawn ship or scout crews from the mate thread.
              </p>
            ) : (
              tree.map((node) => (
                <RailRow
                  key={node.id}
                  node={node}
                  selectedThreadId={selectedThreadId}
                  onSelect={selectThread}
                />
              ))
            )}
          </aside>
          <main className="min-h-0">
            {selectedThreadId ? (
              <ThreadChat
                threadId={selectedThreadId}
                variant="compact"
                layout="contained"
                permissionPolicy="editable"
                className="h-full min-h-0"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a mate or crew to open chat.
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "mate-defaults",
    title: "Mate threads",
    description:
      "Default provider and model for new mate home threads created by Fleet.",
    component: FleetSettingsSection,
  });

  app.slots.navPanel({
    id: "fleet",
    title: "Fleet",
    icon: "./assets/icon.svg",
    path: "fleet",
    component: FleetPage,
  });
});
