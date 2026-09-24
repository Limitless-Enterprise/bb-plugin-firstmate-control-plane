import type { DeliveryMode } from "./types";
import { isChecksGreen, parsePrUrl } from "./status-verbs";

/** Mode-aware PR ready wake (P-P4). */
export function shouldEnqueuePrReadyWake(
  deliveryMode: DeliveryMode,
  doneDetail: string,
): boolean {
  const url = parsePrUrl(doneDetail);
  if (!url) return false;
  if (deliveryMode === "local-only") return false;
  if (deliveryMode === "direct-PR") return true;
  return isChecksGreen(doneDetail);
}

/** Ack matching dedupe family (P-W3 ack-through). */
export function wakeIdsToAckThrough(
  wakes: { id: string; dedupeKey: string | null; acked: boolean }[],
  wakeId: string,
): string[] {
  const target = wakes.find((wake) => wake.id === wakeId);
  if (!target || target.acked) return [];
  const targetKey = target.dedupeKey;
  const ids = new Set<string>([wakeId]);
  if (!targetKey) return [...ids];
  const childPrefix = `${targetKey}:`;
  for (const wake of wakes) {
    if (wake.acked) continue;
    const key = wake.dedupeKey;
    if (!key) continue;
    if (key === targetKey || key.startsWith(childPrefix)) ids.add(wake.id);
  }
  return [...ids];
}
