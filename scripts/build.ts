#!/usr/bin/env bun
/**
 * Build script for LWSync browser extension
 * Run with: bun run build.ts
 *
 * Outputs:
 * - dist/chrome/ - Manifest V3 build for Chrome/Edge
 * - dist/firefox/ - Manifest V3 build for Firefox (128+)
 *
 * Deterministic Build:
 * - Uses SOURCE_DATE_EPOCH for reproducible timestamps
 * - Sorted file operations for consistent output
 * - Version injected from package.json (single source of truth)
 *
 * For fully reproducible builds, use the containerized build:
 *   podman build -t lwsync-build .
 *   podman run --rm -v .:/src:Z lwsync-build
 */

import { $ } from "bun";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "fs";
import { join } from "path";

const DIST_CHROME = "dist/chrome";
const DIST_FIREFOX = "dist/firefox";
const ASSETS = "assets";
const SRC = "src";

console.log("🔨 Building LWSync extension...\n");

// Read version from package.json (single source of truth)
const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
const version = packageJson.version;
console.log(`📌 Version: ${version}\n`);

// Clean dist directories
for (const dist of [DIST_CHROME, DIST_FIREFOX]) {
  if (existsSync(dist)) {
    await $`rm -rf ${dist}`;
  }
  mkdirSync(dist, { recursive: true });
}

// Build service worker for Chrome (ES module)
console.log("📦 Building Chrome service worker...");
await $`bun build ${SRC}/background.ts --outdir=${DIST_CHROME} --target=browser --minify --format=esm`;

// Build background script for Firefox (ES module for MV3)
console.log("📦 Building Firefox background script...");
await $`bun build ${SRC}/background.ts --outdir=${DIST_FIREFOX} --target=browser --minify --format=esm`;

// Build popup for Chrome
console.log("📦 Building Chrome popup...");
await $`bun build ${SRC}/popup.tsx --outdir=${DIST_CHROME} --target=browser --minify --format=esm`;

// Build popup for Firefox
console.log("📦 Building Firefox popup...");
await $`bun build ${SRC}/popup.tsx --outdir=${DIST_FIREFOX} --target=browser --minify --format=esm`;

// Copy assets with sorted ordering for determinism
function copyAssetsSorted(sourceDir: string, destDir: string) {
  const entries = readdirSync(sourceDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        (e.name.endsWith(".html") ||
          e.name.endsWith(".png") ||
          e.name.endsWith(".css"))
    )
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  for (const entry of entries) {
    copyFileSync(join(sourceDir, entry.name), join(destDir, entry.name));
  }
}

// Copy Chrome assets
console.log("📋 Copying Chrome assets...");
copyAssetsSorted(ASSETS, DIST_CHROME);

// Copy Firefox assets
console.log("📋 Copying Firefox assets...");
copyAssetsSorted(ASSETS, DIST_FIREFOX);

// Read, update version, and write Chrome manifest
const chromeManifest = JSON.parse(
  readFileSync(join(ASSETS, "manifest.json"), "utf-8")
);
chromeManifest.version = version;
writeFileSync(
  join(DIST_CHROME, "manifest.json"),
  JSON.stringify(chromeManifest, null, 2) + "\n"
);

// Read, update version, and write Firefox manifest
const firefoxManifest = JSON.parse(
  readFileSync(join(ASSETS, "manifest.firefox.json"), "utf-8")
);
firefoxManifest.version = version;
writeFileSync(
  join(DIST_FIREFOX, "manifest.json"),
  JSON.stringify(firefoxManifest, null, 2) + "\n"
);

console.log("\n✅ Build complete!\n");
