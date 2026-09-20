import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { pathExists, pathIsGitCheckout } from "./firstmate-checkout";

const execFileAsync = promisify(execFile);

export const INTEGRATION_VERSION = 1;

const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const INTEGRATION_SOURCE = path.join(PLUGIN_ROOT, "integration");

export type BbIntegrationConfig = {
  enabled: boolean;
  homeId: string;
  mateThreadId: string;
  version: number;
  appliedAtMs: number;
};

export type ApplyIntegrationInput = {
  checkoutPath: string;
  homeId: string;
  mateThreadId: string;
  log?: { info: (message: string) => void; warn: (message: string) => void };
};

export type ApplyIntegrationResult = {
  checkoutPath: string;
  integrationVersion: number;
  applied: boolean;
  configPath: string;
};

async function copyFileExecutable(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  await fs.chmod(dest, 0o755);
}

async function copyTree(
  sourceDir: string,
  targetDir: string,
  files: string[],
): Promise<void> {
  for (const relative of files) {
    await copyFileExecutable(
      path.join(sourceDir, relative),
      path.join(targetDir, relative),
    );
  }
}

async function ensureGitExclude(
  checkoutPath: string,
  patterns: string[],
): Promise<void> {
  const gitPath = path.join(checkoutPath, ".git");
  let gitStat;
  try {
    gitStat = await fs.stat(gitPath);
  } catch {
    return;
  }
  if (!gitStat.isDirectory()) {
    // Worktrees use a .git file; exclude patterns live in the main repo only.
    return;
  }
  const excludePath = path.join(gitPath, "info", "exclude");
  let existing = "";
  try {
    existing = await fs.readFile(excludePath, "utf8");
  } catch {
    // no exclude file yet
  }
  const missing = patterns.filter(
    (pattern) => !existing.split("\n").includes(pattern),
  );
  if (missing.length === 0) return;
  const suffix = `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${missing.join("\n")}\n`;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.appendFile(excludePath, suffix, "utf8");
}

async function installSpawnStub(checkoutPath: string): Promise<void> {
  const stubPath = path.join(checkoutPath, "bin", "fm-spawn.sh");
  const stub = `#!/usr/bin/env bash
# Managed by firstmate-control-plane BB integration. Do not edit.
set -eu
FM_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
exec "$FM_ROOT/.bb-integration/bin/fm-spawn.sh" "$@"
`;
  await fs.writeFile(stubPath, stub, { mode: 0o755 });
}

async function backupNativeSpawn(checkoutPath: string): Promise<void> {
  const liveSpawn = path.join(checkoutPath, "bin", "fm-spawn.sh");
  const nativeSpawn = path.join(
    checkoutPath,
    ".bb-integration",
    "native",
    "bin",
    "fm-spawn.sh",
  );
  if (await pathExists(nativeSpawn)) return;

  const marker = path.join(checkoutPath, ".bb-integration", "manifest.json");
  if (await pathExists(marker)) {
    throw new Error(
      `Integration manifest exists but native fm-spawn backup is missing at ${nativeSpawn}`,
    );
  }

  const current = await fs.readFile(liveSpawn, "utf8");
  if (current.includes("firstmate-control-plane BB integration")) {
    throw new Error(
      "Cannot bootstrap BB integration: bin/fm-spawn.sh is already a BB stub without a native backup.",
    );
  }

  await copyFileExecutable(liveSpawn, nativeSpawn);
}

export async function applyFirstmateIntegration(
  input: ApplyIntegrationInput,
): Promise<ApplyIntegrationResult> {
  const checkoutPath = input.checkoutPath.trim();
  const homeId = input.homeId.trim();
  const mateThreadId = input.mateThreadId.trim();
  if (!checkoutPath) throw new Error("Checkout path is required.");
  if (!homeId) throw new Error("Home id is required.");
  if (!mateThreadId) throw new Error("Mate thread id is required.");
  if (!(await pathExists(checkoutPath))) {
    throw new Error(`Checkout path does not exist: ${checkoutPath}`);
  }
  if (!(await pathIsGitCheckout(checkoutPath))) {
    throw new Error(`Checkout path is not a git repository: ${checkoutPath}`);
  }

  const spawnPath = path.join(checkoutPath, "bin", "fm-spawn.sh");
  if (!(await pathExists(spawnPath))) {
    throw new Error(`Firstmate checkout missing bin/fm-spawn.sh: ${checkoutPath}`);
  }

  await backupNativeSpawn(checkoutPath);

  const integrationRoot = path.join(checkoutPath, ".bb-integration");
  await copyTree(INTEGRATION_SOURCE, integrationRoot, [
    "bin/fm-bb-lib.sh",
    "bin/fm-bb-spawn.sh",
    "bin/fm-spawn.sh",
  ]);

  const docsDir = path.join(checkoutPath, "docs", "bb-integration");
  await fs.mkdir(docsDir, { recursive: true });
  await fs.copyFile(
    path.join(INTEGRATION_SOURCE, "AGENTS.bb.md"),
    path.join(docsDir, "AGENTS.bb.md"),
  );
  await fs.copyFile(
    path.join(INTEGRATION_SOURCE, "README.md"),
    path.join(docsDir, "README.md"),
  );

  const config: BbIntegrationConfig = {
    enabled: true,
    homeId,
    mateThreadId,
    version: INTEGRATION_VERSION,
    appliedAtMs: Date.now(),
  };
  const configDir = path.join(checkoutPath, "config");
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "bb-integration.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const manifest = {
    integrationVersion: INTEGRATION_VERSION,
    plugin: "firstmate-control-plane",
    homeId,
    mateThreadId,
    appliedAtMs: config.appliedAtMs,
  };
  await fs.writeFile(
    path.join(integrationRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await installSpawnStub(checkoutPath);
  await ensureGitExclude(checkoutPath, [
    ".bb-integration/",
    "config/bb-integration.json",
    "docs/bb-integration/",
  ]);

  input.log?.info(
    `fleet: applied BB integration v${INTEGRATION_VERSION} to ${checkoutPath} (home=${homeId})`,
  );

  return {
    checkoutPath,
    integrationVersion: INTEGRATION_VERSION,
    applied: true,
    configPath,
  };
}

export function matePromptWithBbIntegration(input: {
  label: string;
  homeId: string;
}): string {
  return [
    `You are the ${input.label} mate (Firstmate brain) for Fleet home "${input.homeId}".`,
    "",
    "## BB Fleet integration",
    "",
    "This checkout includes the BB integration overlay (see docs/bb-integration/AGENTS.bb.md).",
    "Dispatch crews with bin/fm-spawn.sh as usual — when BB integration is enabled,",
    "crews are registered in the Fleet UI automatically via bb fleet spawn.",
    "Use bb fleet tree / bb fleet inbox to inspect crews; do not claim a worker is",
    "running unless it appears in the fleet tree or you have a bb thread id.",
  ].join("\n");
}

export async function readIntegrationConfig(
  checkoutPath: string,
): Promise<BbIntegrationConfig | null> {
  const configPath = path.join(checkoutPath, "config", "bb-integration.json");
  if (!(await pathExists(configPath))) return null;
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw) as BbIntegrationConfig;
}

export async function runIntegrationSelfCheck(
  checkoutPath: string,
): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  const root = checkoutPath.trim();
  const required = [
    ".bb-integration/bin/fm-spawn.sh",
    ".bb-integration/bin/fm-bb-spawn.sh",
    ".bb-integration/native/bin/fm-spawn.sh",
    "config/bb-integration.json",
    "docs/bb-integration/AGENTS.bb.md",
  ];
  for (const relative of required) {
    if (!(await pathExists(path.join(root, relative)))) {
      issues.push(`missing ${relative}`);
    }
  }
  const stub = await fs.readFile(path.join(root, "bin", "fm-spawn.sh"), "utf8");
  if (!stub.includes("firstmate-control-plane BB integration")) {
    issues.push("bin/fm-spawn.sh is not the BB integration stub");
  }
  try {
    await execFileAsync("bash", [
      path.join(root, ".bb-integration/bin/fm-bb-lib.sh"),
    ]);
  } catch {
    // sourcing-only script; ignore
  }
  return { ok: issues.length === 0, issues };
}
