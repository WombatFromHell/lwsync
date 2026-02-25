#!/usr/bin/env bun
/**
 * Watch mode for development (Chrome only)
 * Run with: bun run dev
 */

import { $ } from "bun";

console.log("👀 Watching for changes (Chrome build)...\n");

// Start bun build in watch mode for Chrome
await $`bun build src/background.ts --outdir=dist/chrome --target=browser --format=esm --sourcemap --watch`.nothrow();
