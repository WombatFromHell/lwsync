#!/usr/bin/env bun
/**
 * Verify deterministic build archives against SHA256 checksums
 *
 * Usage:
 *   bun run verify                          - Verify dist/ archives against checksums
 *   bun run verify --compare <dir1> <dir2>  - Compare checksums between two build dirs
 */

import { $ } from "bun";
import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

const scriptDir = dirname(import.meta.path);
const projectDir = dirname(scriptDir);
const defaultDistDir = join(projectDir, "dist");

interface VerifyResult {
  name: string;
  passed: boolean;
  actualHash?: string;
  expectedHash?: string;
  error?: string;
}

async function computeHash(archivePath: string): Promise<string> {
  return (await $`sha256sum ${archivePath}`.text()).split(" ")[0].trim();
}

async function verifyArchive(
  distDir: string,
  archiveName: string
): Promise<VerifyResult> {
  const archivePath = join(distDir, archiveName);
  const checksumPath = join(distDir, `${archiveName}.sha256sum`);

  if (!existsSync(archivePath)) {
    return { name: archiveName, passed: false, error: "archive not found" };
  }

  if (!existsSync(checksumPath)) {
    return { name: archiveName, passed: false, error: "checksum file not found" };
  }

  try {
    const checksumContent = readFileSync(checksumPath, "utf-8");
    const expectedHash = checksumContent.split(" ")[0].trim();
    const actualHash = await computeHash(archivePath);

    if (expectedHash === actualHash) {
      return { name: archiveName, passed: true, actualHash, expectedHash };
    } else {
      return {
        name: archiveName,
        passed: false,
        actualHash,
        expectedHash,
        error: "hash mismatch",
      };
    }
  } catch (error) {
    return {
      name: archiveName,
      passed: false,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

function printVerifyResult(result: VerifyResult, verbose = false): boolean {
  if (result.passed) {
    console.log(`✅ ${result.name}: OK`);
    if (verbose && result.actualHash) {
      console.log(`   ${result.actualHash}`);
    }
    return true;
  } else {
    console.error(`❌ ${result.name}: ${result.error}`);
    if (result.expectedHash && result.actualHash) {
      console.error(`  Expected: ${result.expectedHash}`);
      console.error(`  Actual:   ${result.actualHash}`);
    }
    return false;
  }
}

async function verifyDirectory(distDir: string): Promise<boolean> {
  console.log(`🔍 Verifying build archives in ${distDir}...\n`);

  if (!existsSync(distDir)) {
    console.error(`❌ Directory not found: ${distDir}`);
    return false;
  }

  const archives = ["LWSync-chrome.zip", "LWSync-firefox.zip"];
  let allPassed = true;

  for (const archive of archives) {
    const result = await verifyArchive(distDir, archive);
    if (!printVerifyResult(result)) {
      allPassed = false;
    }
  }

  console.log();

  if (allPassed) {
    console.log("✅ All archives verified successfully!");
  } else {
    console.error("❌ Verification failed!");
  }

  return allPassed;
}

async function compareDirectories(dir1: string, dir2: string): Promise<boolean> {
  console.log(`🔍 Comparing build determinism between:\n`);
  console.log(`   Dir 1: ${dir1}`);
  console.log(`   Dir 2: ${dir2}\n`);

  if (!existsSync(dir1)) {
    console.error(`❌ Directory not found: ${dir1}`);
    return false;
  }

  if (!existsSync(dir2)) {
    console.error(`❌ Directory not found: ${dir2}`);
    return false;
  }

  const archives = ["LWSync-chrome.zip", "LWSync-firefox.zip"];
  let allMatched = true;

  for (const archive of archives) {
    const path1 = join(dir1, archive);
    const path2 = join(dir2, archive);

    if (!existsSync(path1)) {
      console.error(`❌ ${archive} not found in ${dir1}`);
      allMatched = false;
      continue;
    }

    if (!existsSync(path2)) {
      console.error(`❌ ${archive} not found in ${dir2}`);
      allMatched = false;
      continue;
    }

    try {
      const hash1 = await computeHash(path1);
      const hash2 = await computeHash(path2);

      console.log(`${archive}:`);
      console.log(`  ${dir1}/`);
      console.log(`    ${hash1}  ${archive}`);
      console.log(`  ${dir2}/`);
      console.log(`    ${hash2}  ${archive}`);

      if (hash1 === hash2) {
        console.log(`  ✅ MATCH\n`);
      } else {
        console.log(`  ❌ MISMATCH\n`);
        allMatched = false;
      }
    } catch (error) {
      console.error(
        `❌ ${archive}: ${error instanceof Error ? error.message : "unknown error"}`
      );
      allMatched = false;
    }
  }

  console.log();

  if (allMatched) {
    console.log("✅ Build determinism verified - archives are identical!");
  } else {
    console.error("❌ Build determinism check failed - archives differ!");
  }

  return allMatched;
}

function parseArgs(): { command: "verify" | "compare"; args: string[] } {
  const args = process.argv.slice(2);

  if (args.includes("--compare") || args.includes("-c")) {
    return { command: "compare", args: args.filter((a) => !a.startsWith("-")) };
  }

  return { command: "verify", args };
}

async function main() {
  const { command, args } = parseArgs();

  if (command === "compare") {
    if (args.length < 2) {
      console.error(
        "Usage: bun run verify --compare <dir1> <dir2>\n" +
          "\nCompare SHA256 checksums of build archives between two directories.\n" +
          "Useful for verifying build reproducibility/determinism.\n" +
          "\nExample:\n" +
          "  bun run verify --compare ./dist-run1 ./dist-run2"
      );
      process.exit(1);
    }

    const dir1 = resolve(args[0]);
    const dir2 = resolve(args[1]);
    const passed = await compareDirectories(dir1, dir2);
    process.exit(passed ? 0 : 1);
  } else {
    const distDir = args[0] ? resolve(args[0]) : defaultDistDir;
    const passed = await verifyDirectory(distDir);
    process.exit(passed ? 0 : 1);
  }
}

main();
