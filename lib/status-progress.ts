/** P-L8: progress-only status touches (refresh busy-age without FSM churn). */

export function isProgressOnlyStatusLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("progress:") || trimmed.startsWith("touch:");
}

export function progressDetailFromLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("progress:")) {
    return trimmed.slice("progress:".length).trim();
  }
  if (trimmed.startsWith("touch:")) {
    return trimmed.slice("touch:".length).trim();
  }
  return trimmed;
}

export const PROGRESS_LEDGER_VERB = "crew.progress";
