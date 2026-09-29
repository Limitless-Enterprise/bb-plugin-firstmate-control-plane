#!/usr/bin/env node
/**
 * Print the BB plugin id for a package.json (same algorithm as submit-a-plugin skill).
 * Usage: node scripts/derive-plugin-id.mjs [path/to/package.json]
 */
import fs from "node:fs";
import path from "node:path";

const pkgPath = path.resolve(process.argv[2] ?? "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
let name = pkg.name ?? "";
if (name.includes("/")) name = name.split("/").pop() ?? name;
const lower = name.toLowerCase();
const stripped = lower.startsWith("bb-plugin-") ? lower.slice("bb-plugin-".length) : lower;
const id = stripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
if (!id) {
  console.error("Could not derive plugin id from package name:", pkg.name);
  process.exit(1);
}
console.log(id);
