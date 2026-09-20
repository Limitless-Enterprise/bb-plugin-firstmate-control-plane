import { writeFileSync, mkdirSync } from "node:fs";
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
const outDir = join(__dirname, "..", ".icon-preview");
mkdirSync(outDir, { recursive: true });

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

function writeIcon(slug, label, group, icon) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" color="#e8ecf4">
  ${iconToPaths(icon)}
</svg>`;
  writeFileSync(join(outDir, `${slug}.svg`), svg);
  return { slug, label, group };
}

const items = [
  writeIcon("01-cargoship", "CargoShip", "nautical", CargoShipIcon),
  writeIcon("02-boat", "Boat", "nautical", BoatIcon),
  writeIcon("03-sail-offshore", "SailboatOffshore", "nautical", SailboatOffshoreIcon),
  writeIcon("04-sail-coastal", "SailboatCoastal", "nautical", SailboatCoastalIcon),
  writeIcon("05-anchor", "Anchor", "nautical", AnchorIcon),
  writeIcon("06-compass", "Compass", "nautical", CompassIcon),
  writeIcon("07-shipment", "ShipmentTracking", "nautical", ShipmentTrackingIcon),
  writeIcon("08-layers", "Layers", "builtin", Layers01Icon),
  writeIcon("09-gitbranch", "GitBranch", "builtin", GitBranchIcon),
  writeIcon("10-globe", "Globe", "builtin", InternetIcon),
  writeIcon("11-explore", "Explore", "builtin", Book02Icon),
  writeIcon("12-gridview", "GridView", "builtin", GridViewIcon),
  writeIcon("13-package", "PackageReceive", "builtin", PackageReceiveIcon),
  writeIcon("14-belldot", "BellDot", "builtin", BellDotIcon),
  writeIcon("15-brain", "Brain", "builtin", BrainIcon),
  writeIcon("16-aibrain", "AiBrain01", "builtin", AiBrain01Icon),
  writeIcon("17-panelbottom", "PanelBottom", "builtin", SidebarBottomIcon),
];

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(items, null, 2));
console.log(outDir);
