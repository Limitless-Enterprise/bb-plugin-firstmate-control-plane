import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CargoShipIcon,
  BoatIcon,
  SailboatOffshoreIcon,
  SailboatCoastalIcon,
  AnchorIcon,
  CompassIcon,
  ShipmentTrackingIcon,
  Layers01Icon,
  GitBranchIcon,
  InternetIcon,
  Book02Icon,
  GridViewIcon,
  PackageReceiveIcon,
  BellDotIcon,
  BrainIcon,
  AiBrain01Icon,
  SidebarBottomIcon,
} from "@hugeicons/core-free-icons";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "icon-preview.html");

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function iconToPaths(icon) {
  return icon
    .map(([tag, attrs]) => {
      const parts = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${camelToKebab(key)}="${value}"`);
      return `<${tag} ${parts.join(" ")} />`;
    })
    .join("");
}

function wrapSvg(icon, size = 48) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="${size}" height="${size}" color="currentColor">${iconToPaths(icon)}</svg>`;
}

function card(name, group, icon) {
  return `
    <div class="card" data-group="${group}">
      <div class="glyph">${wrapSvg(icon)}</div>
      <div class="label">${name}</div>
      <div class="meta">${group}</div>
    </div>`;
}

const sections = [
  {
    title: "Nautical (custom SVG candidates)",
    group: "nautical",
    items: [
      ["CargoShip", CargoShipIcon],
      ["Boat", BoatIcon],
      ["SailboatOffshore", SailboatOffshoreIcon],
      ["SailboatCoastal", SailboatCoastalIcon],
      ["Anchor", AnchorIcon],
      ["Compass", CompassIcon],
      ["ShipmentTracking", ShipmentTrackingIcon],
    ],
  },
  {
    title: "BB builtin (works in package.json today)",
    group: "builtin",
    items: [
      ["Layers", Layers01Icon],
      ["GitBranch", GitBranchIcon],
      ["Globe", InternetIcon],
      ["Explore", Book02Icon],
      ["GridView", GridViewIcon],
      ["PackageReceive", PackageReceiveIcon],
      ["BellDot", BellDotIcon],
      ["Brain", BrainIcon],
      ["AiBrain01", AiBrain01Icon],
      ["PanelBottom", SidebarBottomIcon],
    ],
  },
];

const cards = sections
  .map(
    (section) => `
  <section>
    <h2>${section.title}</h2>
    <div class="grid">
      ${section.items.map(([name, icon]) => card(name, section.group, icon)).join("")}
    </div>
  </section>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fleet plugin icon options</title>
  <style>
    :root {
      color-scheme: dark light;
      --bg: #0b0d12;
      --panel: #151922;
      --text: #e8ecf4;
      --muted: #8b95a8;
      --accent: #6ea8fe;
      --border: #2a3140;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f4f6fb;
        --panel: #ffffff;
        --text: #12151c;
        --muted: #5c6678;
        --accent: #2f6fed;
        --border: #d8dee9;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.4 system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .intro { color: var(--muted); max-width: 70ch; margin-bottom: 24px; }
    section { margin-bottom: 32px; }
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
      color: var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 12px 12px;
      text-align: center;
    }
    .glyph {
      width: 48px;
      height: 48px;
      margin: 0 auto 10px;
      color: var(--text);
    }
    .glyph svg { width: 100%; height: 100%; display: block; }
    .label { font-weight: 600; font-size: 13px; }
    .meta {
      margin-top: 4px;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sizes {
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: center;
      margin-top: 8px;
      color: var(--muted);
    }
    .sizes span { display: inline-flex; align-items: center; gap: 6px; }
    .sizes svg { color: var(--text); }
  </style>
</head>
<body>
  <h1>Fleet plugin — icon options</h1>
  <p class="intro">
    Sidebar-sized preview at 48px. Current setting <code>Ship</code> is invalid and falls back to Zap.
    Nautical row = custom <code>./assets/icon.svg</code> candidates. Builtin row = valid <code>bb.branding.icon</code> names.
  </p>
  ${cards}
  <section>
    <h2>Sidebar scale check</h2>
    <div class="sizes">
      <span>16px CargoShip ${wrapSvg(CargoShipIcon, 16)}</span>
      <span>20px CargoShip ${wrapSvg(CargoShipIcon, 20)}</span>
      <span>24px Layers ${wrapSvg(Layers01Icon, 24)}</span>
      <span>24px Compass ${wrapSvg(CompassIcon, 24)}</span>
    </div>
  </section>
</body>
</html>`;

writeFileSync(outPath, html);
console.log(outPath);
