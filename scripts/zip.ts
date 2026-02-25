#!/usr/bin/env bun
/**
 * Package extensions for distribution with deterministic, reproducible archives
 * Run with: bun run zip
 *
 * Outputs:
 * - dist/LWSync-chrome.zip + dist/LWSync-chrome.zip.sha256sum
 * - dist/LWSync-firefox.zip + dist/LWSync-firefox.zip.sha256sum
 */

import { $ } from "bun";
import { existsSync, writeFileSync, readdirSync } from "fs";
import { join, relative, resolve } from "path";

const DIST_CHROME = "dist/chrome";
const DIST_FIREFOX = "dist/firefox";
const DIST = "dist";

/**
 * Get all files in a directory recursively, sorted for deterministic ordering
 */
function getFilesSorted(dir: string, baseDir: string = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  // Sort entries by name for deterministic ordering (LC_ALL=C style)
  entries.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      files.push(...getFilesSorted(fullPath, baseDir));
    } else {
      // Skip hidden files except specific ones
      if (!entry.name.startsWith(".") || entry.name === ".bun-version") {
        files.push(relPath);
      }
    }
  }

  return files;
}

/**
 * Compute SHA256 hash of a file
 */
async function computeFileHash(filePath: string): Promise<string> {
  const fileData = await Bun.file(filePath).arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate SHA256 checksum file in standard sha256sum format
 */
async function generateChecksumFile(
  zipPath: string,
  checksumPath: string
): Promise<void> {
  const hash = await computeFileHash(zipPath);
  const zipName = relative(DIST, zipPath);
  // Standard sha256sum format: <hash>  <filename> (two spaces)
  const content = `${hash}  ${zipName}\n`;
  writeFileSync(checksumPath, content);
  console.log(`🔐 Generated: ${relative(".", checksumPath)}`);
}

console.log("📦 Packaging extensions with deterministic archives...\n");

if (!existsSync(DIST_CHROME)) {
  console.error("❌ dist/chrome/ not found. Run 'bun run build' first.");
  process.exit(1);
}

if (!existsSync(DIST_FIREFOX)) {
  console.error("❌ dist/firefox/ not found. Run 'bun run build' first.");
  process.exit(1);
}

// Use SOURCE_DATE_EPOCH for reproducible builds (standard for reproducible builds)
// Defaults to 0 (1970-01-01) if not set
const SOURCE_DATE_EPOCH = process.env.SOURCE_DATE_EPOCH || "0";
const zipFlags = "-Xrq"; // -X: exclude extra file attributes, -r: recursive, -q: quiet

// Remove old zips and checksums
await $`rm -f ${DIST}/LWSync-chrome.zip ${DIST}/LWSync-chrome.zip.sha256sum`;
await $`rm -f ${DIST}/LWSync-firefox.zip ${DIST}/LWSync-firefox.zip.sha256sum`;

// Create Chrome zip with deterministic settings
console.log("📦 Creating Chrome archive...");
{
  const files = getFilesSorted(DIST_CHROME);
  const fileListPath = resolve(DIST, ".chrome-files.txt");
  writeFileSync(fileListPath, files.join("\n") + "\n");

  // Touch files with SOURCE_DATE_EPOCH for deterministic timestamps
  await $`find ${DIST_CHROME} -exec touch -d @${SOURCE_DATE_EPOCH} {} +`;

  // Create zip with sorted file list
  await $`cd ${DIST_CHROME} && zip ${zipFlags} ../LWSync-chrome.zip -@ < ${fileListPath}`;
  await $`rm ${fileListPath}`;

  console.log(`✅ Created: ${DIST}/LWSync-chrome.zip`);

  // Generate checksum
  await generateChecksumFile(
    join(DIST, "LWSync-chrome.zip"),
    join(DIST, "LWSync-chrome.zip.sha256sum")
  );
}

// Create Firefox zip with deterministic settings
console.log("\n📦 Creating Firefox archive...");
{
  const files = getFilesSorted(DIST_FIREFOX);
  const fileListPath = resolve(DIST, ".firefox-files.txt");
  writeFileSync(fileListPath, files.join("\n") + "\n");

  // Touch files with SOURCE_DATE_EPOCH for deterministic timestamps
  await $`find ${DIST_FIREFOX} -exec touch -d @${SOURCE_DATE_EPOCH} {} +`;

  // Create zip with sorted file list
  await $`cd ${DIST_FIREFOX} && zip ${zipFlags} ../LWSync-firefox.zip -@ < ${fileListPath}`;
  await $`rm ${fileListPath}`;

  console.log(`✅ Created: ${DIST}/LWSync-firefox.zip`);

  // Generate checksum
  await generateChecksumFile(
    join(DIST, "LWSync-firefox.zip"),
    join(DIST, "LWSync-firefox.zip.sha256sum")
  );
}

console.log("\n✅ Packaging complete!\n");
console.log("📁 Archives:");
console.log(`   ${DIST}/LWSync-chrome.zip`);
console.log(`   ${DIST}/LWSync-firefox.zip`);
console.log("\n🔐 Checksums:");
console.log(`   ${DIST}/LWSync-chrome.zip.sha256sum`);
console.log(`   ${DIST}/LWSync-firefox.zip.sha256sum`);
console.log("\n💡 To verify: bun run verify\n");
