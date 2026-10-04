import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { applyFirstmateIntegration } from "./apply-firstmate-integration";
import {
  applyMateIntegrationToCheckouts,
  mateCheckoutPathsNeedingIntegration,
} from "./mate-worktree-integration";

const execFileAsync = promisify(execFile);

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  tempRoots = [];
});

async function minimalGitCheckout(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-wt-int-"));
  tempRoots.push(root);
  await execFileAsync("git", ["init"], { cwd: root });
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const stub = "#!/usr/bin/env bash\nexit 0\n";
  for (const name of ["fm-spawn.sh", "fm-backend.sh", "fm-teardown.sh"]) {
    await fs.writeFile(path.join(binDir, name), stub, { mode: 0o755 });
  }
  const controlLib = [
    "#!/usr/bin/env bash",
    "supports_key() {",
    "  case \"$1\" in",
    "    tmux|herdr|zellij|cmux)",
    "      case \"$key\" in Escape|Enter|C-c|C-u) return 0 ;; esac",
    "      ;;",
    "  esac",
    "}",
    "state_verified() {",
    "  case \"$1\" in",
    "    tmux|herdr) return 0 ;;",
    "  esac",
    "}",
    "",
  ].join("\n");
  await fs.writeFile(path.join(binDir, "fm-control-lib.sh"), controlLib, {
    mode: 0o755,
  });
  await fs.mkdir(path.join(root, "bin", "backends"), { recursive: true });
  await fs.writeFile(
    path.join(root, "bin", "backends", "tmux.sh"),
    stub,
    { mode: 0o755 },
  );
  return root;
}

function mockBb(worktreePath: string | null): BbPluginApi {
  return {
    log: { info: () => {}, warn: () => {}, error: () => {} },
    sdk: {
      threads: {
        get: async () => ({
          id: "thr_new",
          environmentId: worktreePath ? "env_1" : null,
        }),
      },
      environments: {
        get: async () => ({ path: worktreePath ?? "" }),
      },
    },
  } as unknown as BbPluginApi;
}

describe("mateCheckoutPathsNeedingIntegration", () => {
  it("flags mate worktree when registry is integrated but worktree is not", async () => {
    const registry = await minimalGitCheckout();
    await applyFirstmateIntegration({
      checkoutPath: registry,
      homeId: "tech",
      mateThreadId: "thr_new",
    });

    const worktree = await minimalGitCheckout();
    const bb = mockBb(worktree);

    const needing = await mateCheckoutPathsNeedingIntegration(bb, {
      homeId: "tech",
      checkoutPath: registry,
      mateThreadId: "thr_new",
    });

    assert.deepEqual(needing.sort(), [worktree].sort());
  });

  it("returns empty when registry and worktree both pass self-check", async () => {
    const registry = await minimalGitCheckout();
    const worktree = await minimalGitCheckout();
    await applyFirstmateIntegration({
      checkoutPath: registry,
      homeId: "tech",
      mateThreadId: "thr_new",
    });
    await applyFirstmateIntegration({
      checkoutPath: worktree,
      homeId: "tech",
      mateThreadId: "thr_new",
    });
    const bb = mockBb(worktree);

    const needing = await mateCheckoutPathsNeedingIntegration(bb, {
      homeId: "tech",
      checkoutPath: registry,
      mateThreadId: "thr_new",
    });

    assert.deepEqual(needing, []);
  });
});

describe("applyMateIntegrationToCheckouts", () => {
  it("integrates late worktree paths", async () => {
    const registry = await minimalGitCheckout();
    const worktree = await minimalGitCheckout();
    await applyFirstmateIntegration({
      checkoutPath: registry,
      homeId: "tech",
      mateThreadId: "thr_new",
    });
    const bb = mockBb(worktree);
    const target = {
      homeId: "tech",
      checkoutPath: registry,
      mateThreadId: "thr_new",
    };

    const applied = await applyMateIntegrationToCheckouts(bb, target, [
      worktree,
    ]);
    assert.deepEqual(applied, [worktree]);

    const needing = await mateCheckoutPathsNeedingIntegration(bb, target);
    assert.deepEqual(needing, []);
  });
});
