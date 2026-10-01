import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { OpenChildBlocker } from "../lib/mate-thread-reset";
import { formatOpenChildBlockMessage } from "../lib/mate-thread-reset";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export function MateThreadResetControl({
  homeId,
  mateLabel,
  rpc,
  onReset,
}: {
  homeId: string;
  mateLabel: string;
  rpc: Rpc;
  onReset: (newMateThreadId: string) => void;
}) {
  const [preflight, setPreflight] = useState<{
    allowed: boolean;
    openChildren: OpenChildBlocker[];
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreflight = useCallback(() => {
    setPreflightError(null);
    rpc
      .call("resetMateThreadPreflight", { homeId })
      .then((result) =>
        setPreflight({
          allowed: result.allowed,
          openChildren: result.openChildren,
        }),
      )
      .catch((cause: unknown) => {
        setPreflight(null);
        setPreflightError(
          cause instanceof Error ? cause.message : String(cause),
        );
      });
  }, [homeId, rpc]);

  useEffect(() => {
    loadPreflight();
  }, [loadPreflight]);

  const confirmReset = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("resetMateThread", { homeId });
      setDialogOpen(false);
      onReset(result.mateThreadId);
      loadPreflight();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const blocked = preflight !== null && !preflight.allowed;
  const blockHint =
    blocked && preflight.openChildren.length > 0
      ? formatOpenChildBlockMessage(preflight.openChildren).split("\n")[0]
      : null;

  return (
    <div className="mb-2 space-y-1 border-b border-border px-2 pb-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full justify-start text-xs"
        disabled={blocked || busy || preflight === null}
        aria-label={
          blocked
            ? formatOpenChildBlockMessage(preflight!.openChildren)
            : `Archive the current ${mateLabel} mate thread and start a fresh one`
        }
        onClick={() => setDialogOpen(true)}
      >
        New {mateLabel} mate thread
      </Button>
      {blockHint ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{blockHint}</p>
      ) : null}
      {preflightError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-destructive" role="alert">
            {preflightError}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-auto px-1 py-0 text-[11px]"
            onClick={() => loadPreflight()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new {mateLabel} mate thread?</DialogTitle>
            <DialogDescription>
              The current mate thread will be stopped and archived in BB. Crew
              threads must already be archived (open crews block this action). A
              new mate thread is spawned on the same Firstmate checkout and
              integration is reapplied.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmReset()}>
              {busy ? "Working…" : "Start new mate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
