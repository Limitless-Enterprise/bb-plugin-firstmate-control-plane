import type { BbPluginApi } from "@get-bb/plugin-sdk";
import * as path from "node:path";
import { pathExists } from "./firstmate-checkout";

export type MateCheckoutHome = {
  checkoutPath: string;
  mateThreadId: string;
};

export async function mateEnvironmentPath(
  bb: BbPluginApi,
  mateThreadId: string,
): Promise<string | null> {
  try {
    const thread = await bb.sdk.threads.get({ threadId: mateThreadId });
    if (!thread.environmentId) return null;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    const envPath = environment.path?.trim();
    return envPath || null;
  } catch {
    return null;
  }
}

/** Registry checkout plus the mate thread's live BB environment worktree. */
export async function resolveMateCheckoutPaths(
  bb: BbPluginApi,
  home: MateCheckoutHome,
): Promise<string[]> {
  const paths: string[] = [];
  const registry = home.checkoutPath.trim();
  if (registry) paths.push(registry);
  const envPath = await mateEnvironmentPath(bb, home.mateThreadId);
  if (envPath && envPath !== registry) paths.push(envPath);
  return paths;
}

/** Prefer the checkout that actually owns `state/` (mate worktree when present). */
export async function resolveMateStateRoot(
  bb: BbPluginApi,
  home: MateCheckoutHome,
): Promise<string> {
  for (const checkoutPath of await resolveMateCheckoutPaths(bb, home)) {
    if (await pathExists(path.join(checkoutPath, "state"))) {
      return checkoutPath;
    }
  }
  return home.checkoutPath.trim();
}
