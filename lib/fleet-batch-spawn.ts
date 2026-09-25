/** B-S8: batch spawn specs. */

export type BatchSpawnSpec = {
  label: string;
  role: "ship" | "scout";
  prompt: string;
  profileId?: string | null;
  deliveryMode?: "no-mistakes" | "direct-PR" | "local-only";
  yolo?: boolean;
};

export function parseBatchSpawnJson(raw: string): BatchSpawnSpec[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("batch spawn spec must be a JSON array");
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`batch spawn entry ${index} must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const label = row.label;
    const role = row.role;
    const prompt = row.prompt;
    if (typeof label !== "string" || !label.trim()) {
      throw new Error(`batch spawn entry ${index} missing label`);
    }
    if (role !== "ship" && role !== "scout") {
      throw new Error(`batch spawn entry ${index} role must be ship|scout`);
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error(`batch spawn entry ${index} missing prompt`);
    }
    const spec: BatchSpawnSpec = { label: label.trim(), role, prompt };
    if (typeof row.profileId === "string") spec.profileId = row.profileId;
    if (
      row.deliveryMode === "no-mistakes" ||
      row.deliveryMode === "direct-PR" ||
      row.deliveryMode === "local-only"
    ) {
      spec.deliveryMode = row.deliveryMode;
    }
    if (row.yolo === true) spec.yolo = true;
    return spec;
  });
}
