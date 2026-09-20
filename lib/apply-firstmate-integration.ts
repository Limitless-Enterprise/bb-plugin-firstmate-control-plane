import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { pathExists, pathIsGitCheckout } from "./firstmate-checkout";

const execFileAsync = promisify(execFile);

export const INTEGRATION_VERSION = 2;

const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OVERLAY_SOURCE = path.join(PLUGIN_ROOT, "packages", "bb-backend", "overlay");

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

const OVERLAY_FILES = [
  "bin/fm-bb-lib.sh",
  "bin/fm-bb-spawn.sh",
  "bin/fm-spawn-wrap.sh",
  "bin/fm-backend-wrap.sh",
  "bin/backends/bb.sh",
] as const;

async function copyFileExecutable(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  await fs.chmod(dest, 0o755);
}

async function backupNativeFile(
  checkoutPath: string,
  relativePath: string,
): Promise<void> {
  const livePath = path.join(checkoutPath, relativePath);
  const nativePath = path.join(
    checkoutPath,
    ".bb-integration",
    "native",
    relativePath,
  );
  if (await pathExists(nativePath)) return;

  const marker = path.join(checkoutPath, ".bb-integration", "manifest.json");
  if (await pathExists(marker)) {
    throw new Error(
      `Integration manifest exists but native backup is missing at ${nativePath}`,
    );
  }

  if (!(await pathExists(livePath))) {
    throw new Error(`Firstmate checkout missing ${relativePath}: ${checkoutPath}`);
  }

  const current = await fs.readFile(livePath, "utf8");
  if (current.includes("firstmate-control-plane BB integration")) {
    throw new Error(
      `Cannot bootstrap BB integration: ${relativePath} is already a BB wrapper without a native backup.`,
    );
  }

  await copyFileExecutable(livePath, nativePath);
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
  if (!gitStat.isDirectory()) return;
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

async function installWrapper(
  checkoutPath: string,
  overlayRelative: string,
  targetRelative: string,
): Promise<void> {
  await copyFileExecutable(
    path.join(OVERLAY_SOURCE, overlayRelative),
    path.join(checkoutPath, targetRelative),
  );
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

  await backupNativeFile(checkoutPath, "bin/fm-spawn.sh");
  await backupNativeFile(checkoutPath, "bin/fm-backend.sh");

  const integrationRoot = path.join(checkoutPath, ".bb-integration");
  for (const relative of OVERLAY_FILES) {
    await copyFileExecutable(
      path.join(OVERLAY_SOURCE, relative),
      path.join(integrationRoot, relative),
    );
  }

  await installWrapper(checkoutPath, "bin/fm-spawn-wrap.sh", "bin/fm-spawn.sh");
  await installWrapper(
    checkoutPath,
    "bin/fm-backend-wrap.sh",
    "bin/fm-backend.sh",
  );
  await installWrapper(
    checkoutPath,
    "bin/backends/bb.sh",
    "bin/backends/bb.sh",
  );

  const docsDir = path.join(checkoutPath, "docs", "bb-integration");
  await fs.mkdir(docsDir, { recursive: true });
  await fs.copyFile(
    path.join(OVERLAY_SOURCE, "AGENTS.bb.md"),
    path.join(docsDir, "AGENTS.bb.md"),
  );
  await fs.copyFile(
    path.join(OVERLAY_SOURCE, "README.md"),
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
  await fs.writeFile(path.join(configDir, "backend"), "bb\n", "utf8");

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

  await ensureGitExclude(checkoutPath, [
    ".bb-integration/",
    "config/bb-integration.json",
    "config/backend",
    "docs/bb-integration/",
  ]);

  input.log?.info(
    `fleet: applied BB integration v${INTEGRATION_VERSION} to ${checkoutPath} (home=${homeId}, backend=bb)`,
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
    "This checkout uses config/backend=bb (see docs/bb-integration/AGENTS.bb.md).",
    "Dispatch crews with bin/fm-spawn.sh as usual — ship/scout crews register in Fleet automatically.",
    "Use bb fleet tree / bb fleet inbox to inspect crews; do not claim a worker is running",
    "unless it appears in the fleet tree or you have a bb thread id in state/<task>.meta.",
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
    ".bb-integration/bin/fm-bb-spawn.sh",
    ".bb-integration/bin/backends/bb.sh",
    ".bb-integration/native/bin/fm-spawn.sh",
    ".bb-integration/native/bin/fm-backend.sh",
    "bin/backends/bb.sh",
    "config/bb-integration.json",
    "config/backend",
    "docs/bb-integration/AGENTS.bb.md",
  ];
  for (const relative of required) {
    if (!(await pathExists(path.join(root, relative)))) {
      issues.push(`missing ${relative}`);
    }
  }
  try {
    const backend = await fs.readFile(path.join(root, "config/backend"), "utf8");
    if (backend.trim() !== "bb") {
      issues.push("config/backend is not set to bb");
    }
  } catch {
    issues.push("config/backend unreadable");
  }
  try {
    await execFileAsync("bash", ["-n", path.join(root, "bin/backends/bb.sh")]);
  } catch {
    issues.push("bin/backends/bb.sh has bash syntax errors");
  }
  return { ok: issues.length === 0, issues };
}
