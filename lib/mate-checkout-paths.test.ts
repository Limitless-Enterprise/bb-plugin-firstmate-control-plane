import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMateCheckoutPaths,
  resolveMateStateRoot,
} from "./mate-checkout-paths";

describe("resolveMateCheckoutPaths", () => {
  it("returns registry path when mate environment is unavailable", async () => {
    const bb = {
      sdk: {
        threads: {
          get: async () => {
            throw new Error("missing");
          },
        },
      },
    } as never;
    const paths = await resolveMateCheckoutPaths(bb, {
      checkoutPath: "/registry/firstmate-tech",
      mateThreadId: "thr_test",
    });
    assert.deepEqual(paths, ["/registry/firstmate-tech"]);
  });

  it("includes mate environment path when distinct from registry", async () => {
    const bb = {
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
        },
        environments: {
          get: async () => ({ path: "/worktree/firstmate-tech" }),
        },
      },
    } as never;
    const paths = await resolveMateCheckoutPaths(bb, {
      checkoutPath: "/registry/firstmate-tech",
      mateThreadId: "thr_test",
    });
    assert.deepEqual(paths, [
      "/registry/firstmate-tech",
      "/worktree/firstmate-tech",
    ]);
  });
});

describe("resolveMateStateRoot", () => {
  it("prefers the path that contains state/", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-state-root-"));
    const registry = path.join(root, "registry");
    const worktree = path.join(root, "worktree");
    await fs.mkdir(registry, { recursive: true });
    await fs.mkdir(path.join(worktree, "state"), { recursive: true });

    const bb = {
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
        },
        environments: {
          get: async () => ({ path: worktree }),
        },
      },
    } as never;

    const stateRoot = await resolveMateStateRoot(bb, {
      checkoutPath: registry,
      mateThreadId: "thr_test",
    });
    assert.equal(stateRoot, worktree);
  });
});
