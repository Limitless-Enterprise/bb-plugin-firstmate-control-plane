import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  applyFirstmateIntegration,
  readIntegrationConfig,
  runIntegrationSelfCheck,
} from "./apply-firstmate-integration";
import { resolveMateCheckoutPaths } from "./mate-checkout-paths";

export type MateHomeIntegrationTarget = {
  homeId: string;
  checkoutPath: string;
  mateThreadId: string;
};

export async function mateCheckoutPathsNeedingIntegration(
  bb: BbPluginApi,
  home: MateHomeIntegrationTarget,
): Promise<string[]> {
  const paths = await resolveMateCheckoutPaths(bb, {
    checkoutPath: home.checkoutPath,
    mateThreadId: home.mateThreadId,
  });
  const needing: string[] = [];
  for (const checkoutPath of paths) {
    const check = await runIntegrationSelfCheck(checkoutPath);
    if (!check.ok) {
      needing.push(checkoutPath);
      continue;
    }
    const config = await readIntegrationConfig(checkoutPath);
    if (
      config &&
      (config.homeId !== home.homeId ||
        config.mateThreadId !== home.mateThreadId)
    ) {
      needing.push(checkoutPath);
    }
  }
  return needing;
}

export async function applyMateIntegrationToCheckouts(
  bb: BbPluginApi,
  home: MateHomeIntegrationTarget,
  checkoutPaths: string[],
): Promise<string[]> {
  const applied: string[] = [];
  for (const checkoutPath of checkoutPaths) {
    await applyFirstmateIntegration({
      checkoutPath,
      homeId: home.homeId,
      mateThreadId: home.mateThreadId,
      log: bb.log,
    });
    applied.push(checkoutPath);
  }
  return applied;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
