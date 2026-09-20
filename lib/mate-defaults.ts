export const MATE_DEFAULTS_KV_KEY = "mate-defaults";

export type MateDefaults = {
  providerId: string;
  model: string;
};

export const DEFAULT_MATE_DEFAULTS: MateDefaults = {
  providerId: "acp-cursor",
  model: "composer-2.5",
};

export function normalizeMateDefaults(
  value: Partial<MateDefaults> | null | undefined,
): MateDefaults {
  const providerId = value?.providerId?.trim();
  const model = value?.model?.trim();
  if (!providerId || !model) {
    return DEFAULT_MATE_DEFAULTS;
  }
  return { providerId, model };
}
