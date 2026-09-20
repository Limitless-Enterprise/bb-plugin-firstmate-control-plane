import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_FIRSTMATE_REPO_URL =
  "https://github.com/kunchenguid/firstmate.git";
export const DEFAULT_PARENT_DIR = "/workspace/Codes";

export function checkoutPathForHome(parentDir: string, homeId: string): string {
  const parent = parentDir.trim().replace(/\/+$/, "");
  if (!parent) {
    throw new Error("Parent directory is required.");
  }
  return path.join(parent, `firstmate-${homeId}`);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function pathIsGitCheckout(targetPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(targetPath, ".git");
    const stat = await fs.stat(gitPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function ensureFirstmateCheckout(input: {
  checkoutPath: string;
  repoUrl: string;
  log?: { info: (message: string) => void; warn: (message: string) => void };
}): Promise<{ cloned: boolean; checkoutPath: string }> {
  const checkoutPath = input.checkoutPath.trim();
  const repoUrl = input.repoUrl.trim();
  if (!checkoutPath) {
    throw new Error("Checkout path is required.");
  }
  if (!repoUrl) {
    throw new Error("Firstmate repository URL is required.");
  }

  const exists = await pathExists(checkoutPath);
  if (exists) {
    if (await pathIsGitCheckout(checkoutPath)) {
      input.log?.info(`fleet: using existing checkout at ${checkoutPath}`);
      return { cloned: false, checkoutPath };
    }
    throw new Error(
      `Path already exists but is not a git checkout: ${checkoutPath}`,
    );
  }

  const parentDir = path.dirname(checkoutPath);
  await fs.mkdir(parentDir, { recursive: true });

  input.log?.info(`fleet: cloning ${repoUrl} → ${checkoutPath}`);
  try {
    await execFileAsync("git", ["clone", repoUrl, checkoutPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (cause: unknown) {
    const message =
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "git clone failed";
    throw new Error(`Failed to clone Firstmate: ${message}`);
  }

  if (!(await pathIsGitCheckout(checkoutPath))) {
    throw new Error(
      `Clone finished but ${checkoutPath} is not a git repository.`,
    );
  }

  return { cloned: true, checkoutPath };
}
