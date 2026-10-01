/** Firstmate state/*.meta markers for Fleet close-out (B-S9 guards). */

export const META_FLEET_DETACHED = "fleet_detached";

export function isMetaFleetDetached(meta: string): boolean {
  const match = meta.match(/^fleet_detached=(.+)$/m);
  const value = match?.[1]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function appendMetaFleetDetached(meta: string): string {
  if (isMetaFleetDetached(meta)) return meta;
  const trimmed = meta.replace(/\s+$/, "");
  return `${trimmed}\n${META_FLEET_DETACHED}=1\n`;
}
