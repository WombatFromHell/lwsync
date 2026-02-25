#!/usr/bin/env bun
/**
 * Production build script for LWSync - creates reproducible build in container
 * Run with: bun run build:prod
 *
 * For faster development builds, use: bun run build
 */

import { $ } from "bun";
import { dirname } from "path";
import { mkdirSync } from "fs";

const scriptDir = dirname(import.meta.path);
const projectDir = dirname(scriptDir);
const distDir = `${projectDir}/dist`;

// Detect container runtime
async function detectContainerRuntime(): Promise<"podman" | "docker"> {
  try {
    await $`command -v podman`.quiet();
    return "podman";
  } catch {
    try {
      await $`command -v docker`.quiet();
      return "docker";
    } catch {
      throw new Error("No container runtime found (need podman or docker)");
    }
  }
}

async function main() {
  console.log("🔨 Building LWSync with container...\n");

  const runtime = await detectContainerRuntime();
  console.log(`📦 Using container runtime: ${runtime}`);

  // Build container image
  console.log("\n📦 Building container image...");
  await $`${runtime} build -t lwsync-build .`.cwd(projectDir);

  // Ensure dist/ exists for volume mount
  mkdirSync(distDir, { recursive: true });

  console.log("\n🏗️  Running build in container...");

  // Run build with volume mounts
  if (runtime === "podman") {
    await $`${runtime} run --rm \
      --security-opt label=disable \
      -v ${projectDir}:/app:Z \
      -v ${distDir}:/app/dist:Z \
      lwsync-build`.cwd(projectDir);
  } else {
    await $`${runtime} run --rm \
      -v ${projectDir}:/app \
      -v ${distDir}:/app/dist \
      lwsync-build`.cwd(projectDir);
  }

  console.log("\n✅ Build complete!\n");
  console.log("🔐 Verifying checksums:");

  // Run verification
  const verifyScript = `${scriptDir}/verify.ts`;
  await $`bun run ${verifyScript}`;
}

main().catch((error) => {
  console.error("❌ Build failed");
  console.error(error);
  process.exit(1);
});
