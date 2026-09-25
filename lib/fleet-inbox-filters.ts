/** P-H9: inbox list filters. */

import type { InboxItem } from "./types";

export type InboxKindFilter = InboxItem["kind"] | "all";

export function filterInboxItems(
  items: InboxItem[],
  kind: InboxKindFilter,
): InboxItem[] {
  if (kind === "all") return items;
  return items.filter((item) => item.kind === kind);
}

export const INBOX_FILTER_LABELS: Record<InboxKindFilter, string> = {
  all: "All",
  hold: "Decisions",
  wake: "Wakes",
  liveness: "Liveness",
  stall: "Stalls",
  pr: "PR",
};
