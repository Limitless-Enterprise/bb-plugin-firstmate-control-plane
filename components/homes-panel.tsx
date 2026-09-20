import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { Home } from "../lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { DirectoryPickerDialog } from "./directory-picker-dialog";

type ThreadCandidate = { id: string; title: string; projectId: string };

const fieldLabel = "mb-1 block text-xs font-medium text-muted-foreground";
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function slugifyHomeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type CheckoutPreview = {
  checkoutPath: string;
  exists: boolean;
  isGitRepo: boolean;
  repoUrl: string;
};

function HomeFormFields({
  homeId,
  setHomeId,
  label,
  setLabel,
  parentDir,
  setParentDir,
  checkoutPreview,
  mateMode,
  setMateMode,
  mateThreadId,
  setMateThreadId,
  matePrompt,
  setMatePrompt,
  threads,
  loadingThreads,
  onBrowseParent,
  homeIdLocked,
  checkoutPath,
  setCheckoutPath,
  editMode,
}: {
  homeId: string;
  setHomeId: (value: string) => void;
  label: string;
  setLabel: (value: string) => void;
  parentDir?: string;
  setParentDir?: (value: string) => void;
  checkoutPreview?: CheckoutPreview | null;
  mateMode: "existing" | "create";
  setMateMode: (value: "existing" | "create") => void;
  mateThreadId: string;
  setMateThreadId: (value: string) => void;
  matePrompt: string;
  setMatePrompt: (value: string) => void;
  threads: ThreadCandidate[];
  loadingThreads: boolean;
  onBrowseParent?: () => void;
  homeIdLocked?: boolean;
  checkoutPath?: string;
  setCheckoutPath?: (value: string) => void;
  editMode?: boolean;
}) {
  const { threadId: contextThreadId } = useBbContext();

  return (
    <div className="space-y-4">
      <div>
        <label className={fieldLabel} htmlFor="fleet-home-id">Home id</label>
        <Input
          id="fleet-home-id"
          value={homeId}
          disabled={homeIdLocked}
          placeholder="cto"
          onChange={(event) => setHomeId(slugifyHomeId(event.target.value))}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Lowercase slug — used in CLI and isolation boundaries.
        </p>
      </div>
      <div>
        <label className={fieldLabel} htmlFor="fleet-home-label">Label</label>
        <Input
          id="fleet-home-label"
          value={label}
          placeholder="CTO"
          onChange={(event) => {
            setLabel(event.target.value);
            if (!homeIdLocked && homeId === "") {
              setHomeId(slugifyHomeId(event.target.value));
            }
          }}
        />
      </div>
      {editMode ? (
        <div>
          <label className={fieldLabel} htmlFor="fleet-checkout-edit">
            Firstmate checkout
          </label>
          <div className="flex gap-2">
            <Input
              id="fleet-checkout-edit"
              value={checkoutPath ?? ""}
              onChange={(event) => setCheckoutPath?.(event.target.value)}
            />
            <Button type="button" variant="outline" onClick={onBrowseParent}>
              Browse
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={fieldLabel} htmlFor="fleet-parent-dir">
              Install under
            </label>
            <div className="flex gap-2">
              <Input
                id="fleet-parent-dir"
                value={parentDir ?? ""}
                placeholder="/workspace/Codes"
                onChange={(event) => setParentDir?.(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={onBrowseParent}>
                Browse
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Fleet clones Firstmate into{" "}
              <code>firstmate-&lt;home-id&gt;</code> under this folder.
            </p>
          </div>
          {checkoutPreview ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="font-medium text-foreground">Checkout path</div>
              <code className="mt-1 block break-all text-muted-foreground">
                {checkoutPreview.checkoutPath}
              </code>
              <div className="mt-2 text-muted-foreground">
                Source: {checkoutPreview.repoUrl}
              </div>
              {checkoutPreview.exists ? (
                <div className="mt-1 text-muted-foreground">
                  {checkoutPreview.isGitRepo
                    ? "Existing git checkout — will be reused."
                    : "Path exists but is not a git repo — creation will fail."}
                </div>
              ) : (
                <div className="mt-1 text-muted-foreground">
                  Will clone on create.
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
      {!homeIdLocked ? (
        <div className="space-y-2">
          <span className={fieldLabel}>Mate thread</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mateMode === "existing" ? "secondary" : "ghost"}
              onClick={() => setMateMode("existing")}
            >
              Use existing
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mateMode === "create" ? "secondary" : "ghost"}
              onClick={() => setMateMode("create")}
            >
              Create new
            </Button>
          </div>
          {mateMode === "existing" ? (
            <select
              className={selectClass}
              value={mateThreadId}
              onChange={(event) => setMateThreadId(event.target.value)}
            >
              <option value="">
                {loadingThreads ? "Loading threads…" : "Select a thread"}
              </option>
              {contextThreadId ? (
                <option value={contextThreadId}>
                  Current thread ({contextThreadId})
                </option>
              ) : null}
              {threads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.title}
                </option>
              ))}
            </select>
          ) : (
            <div>
              <label className={fieldLabel} htmlFor="fleet-mate-prompt">
                Mate bootstrap prompt (optional)
              </label>
              <Input
                id="fleet-mate-prompt"
                value={matePrompt}
                placeholder="You are the CTO mate…"
                onChange={(event) => setMatePrompt(event.target.value)}
              />
            </div>
          )}
        </div>
      ) : (
        <div>
          <label className={fieldLabel} htmlFor="fleet-mate-thread-edit">
            Mate thread
          </label>
          <select
            id="fleet-mate-thread-edit"
            className={selectClass}
            value={mateThreadId}
            onChange={(event) => setMateThreadId(event.target.value)}
          >
            <option value="">
              {loadingThreads ? "Loading threads…" : "Select a thread"}
            </option>
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function CreateHomeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (home: Home) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [homeId, setHomeId] = useState("");
  const [label, setLabel] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [checkoutPreview, setCheckoutPreview] = useState<CheckoutPreview | null>(
    null,
  );
  const [mateMode, setMateMode] = useState<"existing" | "create">("create");
  const [mateThreadId, setMateThreadId] = useState("");
  const [matePrompt, setMatePrompt] = useState("");
  const [threads, setThreads] = useState<ThreadCandidate[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingPhase, setPendingPhase] = useState<"clone" | "register" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);

  const loadThreads = useCallback(() => {
    setLoadingThreads(true);
    rpc
      .call("listThreadCandidates", { limit: 50 })
      .then((result) => setThreads(result.threads))
      .catch(() => setThreads([]))
      .finally(() => setLoadingThreads(false));
  }, [rpc]);

  const refreshPreview = useCallback(async () => {
    if (!homeId.trim() || !parentDir.trim()) {
      setCheckoutPreview(null);
      return;
    }
    try {
      const preview = await rpc.call("previewHomeCheckout", {
        homeId,
        parentDir,
      });
      setCheckoutPreview(preview);
    } catch {
      setCheckoutPreview(null);
    }
  }, [homeId, parentDir, rpc]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    loadThreads();
    rpc
      .call("getHomeCreateDefaults", null)
      .then((defaults) => setParentDir(defaults.defaultParentDir))
      .catch(() => setParentDir("/workspace/Codes"));
  }, [open, loadThreads, rpc]);

  useEffect(() => {
    if (!open) return;
    void refreshPreview();
  }, [open, refreshPreview]);

  const browseParent = async () => {
    try {
      const result = await rpc.call("pickCheckoutFolder", {});
      if (result.path) {
        setParentDir(result.path);
        return;
      }
      if (result.useDirectoryBrowser) {
        setDirectoryPickerOpen(true);
      }
    } catch {
      setDirectoryPickerOpen(true);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setPendingPhase("clone");
    setError(null);
    try {
      const trimmedPrompt = matePrompt.trim();
      const home =
        mateMode === "create"
          ? await rpc.call(
              "createHomeWithMateThread",
              trimmedPrompt
                ? { homeId, label, parentDir, prompt: trimmedPrompt }
                : { homeId, label, parentDir },
            )
          : await rpc.call("createHome", {
              homeId,
              label,
              parentDir,
              mateThreadId,
            });
      setPendingPhase("register");
      onCreated(home);
      onOpenChange(false);
      setHomeId("");
      setLabel("");
      setParentDir("");
      setCheckoutPreview(null);
      setMateThreadId("");
      setMatePrompt("");
      setMateMode("create");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
      setPendingPhase(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add mate home</DialogTitle>
            <DialogDescription>
              Clones Firstmate into a new checkout, spawns the mate thread, and
              registers a peer home (CTO, CFO, …).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <HomeFormFields
              homeId={homeId}
              setHomeId={setHomeId}
              label={label}
              setLabel={setLabel}
              parentDir={parentDir}
              setParentDir={setParentDir}
              checkoutPreview={checkoutPreview}
              mateMode={mateMode}
              setMateMode={setMateMode}
              mateThreadId={mateThreadId}
              setMateThreadId={setMateThreadId}
              matePrompt={matePrompt}
              setMatePrompt={setMatePrompt}
              threads={threads}
              loadingThreads={loadingThreads}
              onBrowseParent={() => void browseParent()}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !parentDir.trim() || !homeId.trim()}>
              {pending
                ? pendingPhase === "clone"
                  ? "Cloning Firstmate…"
                  : "Creating home…"
                : "Create home"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DirectoryPickerDialog
        open={directoryPickerOpen}
        onOpenChange={setDirectoryPickerOpen}
        initialPath={parentDir || "/workspace/Codes"}
        onSelect={setParentDir}
      />
    </Dialog>
  );
}

function EditHomeDialog({
  home,
  open,
  onOpenChange,
  onSaved,
}: {
  home: Home | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [label, setLabel] = useState("");
  const [checkoutPath, setCheckoutPath] = useState("");
  const [mateThreadId, setMateThreadId] = useState("");
  const [threads, setThreads] = useState<ThreadCandidate[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);

  useEffect(() => {
    if (!home || !open) return;
    setLabel(home.label);
    setCheckoutPath(home.checkoutPath);
    setMateThreadId(home.mateThreadId);
    setError(null);
    setLoadingThreads(true);
    rpc
      .call("listThreadCandidates", { limit: 50 })
      .then((result) => setThreads(result.threads))
      .catch(() => setThreads([]))
      .finally(() => setLoadingThreads(false));
  }, [home, open, rpc]);

  const browse = async () => {
    try {
      const result = await rpc.call("pickCheckoutFolder", {});
      if (result.path) {
        setCheckoutPath(result.path);
        return;
      }
      if (result.useDirectoryBrowser) {
        setDirectoryPickerOpen(true);
      }
    } catch {
      setDirectoryPickerOpen(true);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!home) return;
    setPending(true);
    setError(null);
    try {
      await rpc.call("updateHome", {
        homeId: home.homeId,
        label,
        checkoutPath,
        mateThreadId,
      });
      onSaved();
      onOpenChange(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  if (!home) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit {home.label}</DialogTitle>
            <DialogDescription>
              Home id <code>{home.homeId}</code> is fixed after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <HomeFormFields
              homeId={home.homeId}
              setHomeId={() => undefined}
              label={label}
              setLabel={setLabel}
              checkoutPath={checkoutPath}
              setCheckoutPath={setCheckoutPath}
              mateMode="existing"
              setMateMode={() => undefined}
              mateThreadId={mateThreadId}
              setMateThreadId={setMateThreadId}
              matePrompt=""
              setMatePrompt={() => undefined}
              threads={threads}
              loadingThreads={loadingThreads}
              onBrowseParent={() => void browse()}
              homeIdLocked
              editMode
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DirectoryPickerDialog
        open={directoryPickerOpen}
        onOpenChange={setDirectoryPickerOpen}
        initialPath={checkoutPath || "/workspace/Codes"}
        onSelect={setCheckoutPath}
      />
    </Dialog>
  );
}

export function HomesPanel({
  homes,
  selectedHomeId,
  onSelectHome,
  onChanged,
}: {
  homes: Home[];
  selectedHomeId: string | null;
  onSelectHome: (homeId: string) => void;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editHome, setEditHome] = useState<Home | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Home | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setPendingDelete(true);
    setError(null);
    try {
      await rpc.call("deleteHome", { homeId: deleteTarget.homeId });
      setDeleteTarget(null);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingDelete(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Mate homes</h2>
          <p className="text-xs text-muted-foreground">
            Peer-isolated executives — CTO, CFO, and more.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Icon name="Plus" className="size-4" />
          Add home
        </Button>
      </div>

      {error ? (
        <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {homes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No mate homes yet.</p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            Create your first home
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {homes.map((home) => (
            <li
              key={home.homeId}
              className={cn(
                "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center",
                selectedHomeId === home.homeId && "bg-state-hover/50",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{home.label}</span>
                  <code className="text-xs text-muted-foreground">{home.homeId}</code>
                  {selectedHomeId === home.homeId ? (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      active
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {home.checkoutPath}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  Mate thread: {home.mateThreadId}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={selectedHomeId === home.homeId ? "secondary" : "outline"}
                  onClick={() => onSelectHome(home.homeId)}
                >
                  {selectedHomeId === home.homeId ? "Selected" : "Select"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditHome(home)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(home)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateHomeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(home) => {
          onChanged();
          onSelectHome(home.homeId);
        }}
      />
      <EditHomeDialog
        home={editHome}
        open={editHome !== null}
        onOpenChange={(open) => {
          if (!open) setEditHome(null);
        }}
        onSaved={onChanged}
      />
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.label}?</DialogTitle>
            <DialogDescription>
              Removes this home and all Fleet registry data for it (crews,
              inbox, wakes). BB threads are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pendingDelete}
              onClick={() => void confirmDelete()}
            >
              {pendingDelete ? "Deleting…" : "Delete home"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
