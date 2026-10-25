import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { Home, TreeNode } from "../lib/types";
import { MateThreadResetControl } from "@/components/mate-thread-reset";
import { FleetTreeRows } from "@/components/fleet-tree-rows";
import {
  FLEET_REALTIME_TOPIC,
  fleetPanelFromSubPath,
} from "../lib/fleet-ui";

export function FleetSidebarTree({ subPath }: { subPath?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [homes, setHomes] = useState<Home[]>([]);
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const treeRequestHomeId = useRef<string | null>(null);
  const homesRequestId = useRef(0);

  const selectedThreadId = useMemo(() => {
    const { threadId } = fleetPanelFromSubPath(subPath);
    return threadId;
  }, [subPath]);

  const refetchTree = useCallback(
    (homeId: string | null) => {
      if (!homeId) {
        treeRequestHomeId.current = null;
        setTree([]);
        setError(null);
        return;
      }
      treeRequestHomeId.current = homeId;
      setError(null);
      rpc
        .call("getTree", { homeId })
        .then((result) => {
          if (treeRequestHomeId.current !== homeId) {
            return;
          }
          setTree(result.tree);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (treeRequestHomeId.current !== homeId) {
            return;
          }
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    },
    [rpc],
  );

  const refetchHomes = useCallback(() => {
    const requestId = ++homesRequestId.current;
    setError(null);
    treeRequestHomeId.current = null;
    setTree([]);
    rpc
      .call("listHomes", null)
      .then((result) => {
        if (homesRequestId.current !== requestId) {
          return;
        }
        setHomes(result.homes);
        setSelectedHomeId(result.selectedHomeId);
        refetchTree(result.selectedHomeId);
      })
      .catch((cause: unknown) => {
        if (homesRequestId.current !== requestId) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [rpc, refetchTree]);

  useEffect(() => {
    refetchHomes();
  }, [refetchHomes]);

  useRealtime(FLEET_REALTIME_TOPIC, () => {
    refetchHomes();
  });

  const selectThread = (threadId: string) => {
    navigate.toPluginPanel("fleet", { subPath: `thread/${threadId}` });
  };

  const mateLabel =
    homes.find((home) => home.homeId === selectedHomeId)?.label ??
    selectedHomeId;

  if (!selectedHomeId) {
    return (
      <div className="px-2 py-4 text-sm text-muted-foreground">
        No mate home selected. Open Fleet and create or select a home.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 p-2">
      {error ? (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      ) : null}
      <MateThreadResetControl
        homeId={selectedHomeId}
        mateLabel={mateLabel ?? selectedHomeId}
        rpc={rpc}
        onReset={(mateThreadId) => {
          selectThread(mateThreadId);
          refetchHomes();
        }}
      />
      {tree.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">
          No crews in the tree yet. The mate thread dispatches ship, scout, and
          secondmate threads when work is delegated.
        </p>
      ) : (
        <FleetTreeRows
          tree={tree}
          selectedThreadId={selectedThreadId}
          onSelectThread={selectThread}
        />
      )}
    </div>
  );
}
