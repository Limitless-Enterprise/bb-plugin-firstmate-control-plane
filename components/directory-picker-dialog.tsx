import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type DirEntry = {
  kind: "file" | "directory";
  name: string;
  path: string;
};

export function DirectoryPickerDialog({
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath: string;
  onSelect: (path: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const listing = await rpc.call("browseHostDirectory", {
          path: path?.trim() || undefined,
        });
        setCurrentPath(listing.directory);
        setParentPath(listing.parent);
        setEntries(
          listing.entries.filter((entry) => entry.kind === "directory"),
        );
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath);
    void load(initialPath);
  }, [open, initialPath, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose folder</DialogTitle>
          <DialogDescription>
            Pick where Fleet should install this mate home checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <code className="block break-all rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            {currentPath}
          </code>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No subfolders here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                        "hover:bg-state-hover",
                      )}
                      onClick={() => void load(entry.path)}
                    >
                      <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            disabled={!parentPath || loading}
            onClick={() => parentPath && void load(parentPath)}
          >
            Up
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={loading || !currentPath}
            onClick={() => {
              onSelect(currentPath);
              onOpenChange(false);
            }}
          >
            Select folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
