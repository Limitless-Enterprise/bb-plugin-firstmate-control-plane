#!/usr/bin/env node
/**
 * Validate package.json version against Limitless Enterprise CalVer (stable or pre-release).
 * https://github.com/Limitless-Enterprise/guidelines/blob/main/docs/05-technology/03-calver-versioning.md
 */
import fs from "node:fs";
import path from "node:path";

const pkgPath = path.resolve(process.argv[2] ?? "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const v = pkg.version;
if (typeof v !== "string" || !v.trim()) {
  console.error("Missing version in", pkgPath);
  process.exit(1);
}

// Stable: YYYY.M.MICRO — month not zero-padded (1–12), MICRO numeric without leading zeros
const stable =
  /^(?<y>[0-9]{4})\.(?<m>(?:[1-9]|1[0-2]))\.(?<micro>[0-9]+)$/.exec(v);
const prerelease =
  /^(?<y>[0-9]{4})\.(?<m>(?:[1-9]|1[0-2]))\.(?<micro>[0-9]+)-(?<kind>alpha|beta|rc)\.(?<n>[0-9]+)$/.exec(
    v,
  );

const match = stable ?? prerelease;
if (!match?.groups) {
  console.error(
    "Version must be CalVer YYYY.MM.MICRO or YYYY.MM.MICRO-{alpha|beta|rc}.N:",
    v,
  );
  process.exit(1);
}

const { y, m, micro } = match.groups;
if (micro.length > 1 && micro.startsWith("0")) {
  console.error("MICRO must not use leading zeros:", v);
  process.exit(1);
}

console.log(`OK CalVer ${v} (${y} UTC month ${m}, micro ${micro})`);
