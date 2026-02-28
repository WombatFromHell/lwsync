/**
 * Watch mode with hot-reload for Chrome extension development
 * Run with: bun run scripts/watch.ts
 *
 * Hot-reload strategy:
 * - CSS changes   → Tailwind's own --watch process recompiles incrementally,
 *                   signals completion via stdout. Stylesheet patched in-place
 *                   via WebSocket. Popup tab stays open, changes appear instantly.
 * - JS/TS changes → full chrome.runtime.reload() via WebSocket.
 *
 * Dev-only additions applied to dist/chrome at build time (sources untouched):
 *   manifest.json  → "management" permission + "open-popup-tab" command
 *   background.js  → WebSocket hot-reload client + keep-alive ping + open-popup-tab handler
 *   popup.js       → in-place CSS patch listener + background readiness guard
 *
 * Press Ctrl+Shift+P (Cmd+Shift+P on Mac) in Chrome to open the popup as a
 * regular tab — it survives extension reloads so you can iterate on CSS freely.
 *
 * No external libraries required — uses Bun's built-in WebSocket server.
 */

import { watch, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// watch.ts lives in scripts/ — go up one level to reach the project root
const ROOT = join(import.meta.dir, "..");
const DIST_CHROME = join(ROOT, "dist/chrome");
const SRC = join(ROOT, "src");
const ASSETS = join(ROOT, "assets");
const WS_PORT = 35729;

// How long to wait after the build finishes before broadcasting the reload
// signal. Chrome needs a moment to notice the updated extension files on disk
// before we tell the service worker to call chrome.runtime.reload() — if we
// signal too early the new service worker starts from the old files and the
// popup opens into a half-initialized gap.
const RELOAD_DELAY_MS = 300;

// ─── WebSocket Server ─────────────────────────────────────────────────────────

type ReloadMessage =
  | { type: "reload" } // full extension reload (JS/asset changed)
  | { type: "css"; css: string }; // in-place CSS patch (no reload needed)

const wsClients = new Set<any>();

Bun.serve({
  port: WS_PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("LWSync hot-reload server", { status: 200 });
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      console.log(`🔌 Extension connected (${wsClients.size} client(s))`);
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(`🔌 Extension disconnected (${wsClients.size} client(s))`);
    },
    message() {},
  },
});

function broadcast(message: ReloadMessage) {
  const payload = JSON.stringify(message);
  let count = 0;
  for (const client of wsClients) {
    try {
      client.send(payload);
      count++;
    } catch {
      wsClients.delete(client);
    }
  }
  if (count > 0) {
    const label = message.type === "css" ? "CSS patch" : "Reload signal";
    console.log(`🔄 ${label} sent to ${count} client(s)`);
  } else {
    console.log("ℹ️  No extension clients connected — reload manually once");
  }
}

console.log(
  `🚀 Hot-reload WebSocket server running on ws://localhost:${WS_PORT}\n`
);

// ─── Dev code injected into dist/chrome/background.js ────────────────────────

const DEV_BACKGROUND_SNIPPET = `
// ── LWSync Dev (injected by watch.ts — not in source) ──
(function lwsyncDev() {
  // ── 1. Readiness flag ─────────────────────────────────────────────────────
  // Written at the very end of background startup so the popup can tell
  // whether the service worker has finished initializing after a reload.
  // chrome.storage.session is cleared automatically when the service worker
  // restarts, so this is always absent during the cold-start window — no
  // manual cleanup needed.
  chrome.storage.session.set({ lwsyncBackgroundReady: true });

  // ── 2. WebSocket hot-reload client + keep-alive ────────────────────────
  // Chrome terminates idle service workers after ~30s. We call a cheap
  // chrome.* API every 20s while the WebSocket is open to reset the idle
  // timer and keep the worker alive for reload signals.
  const WS_URL = "ws://localhost:${WS_PORT}";
  const KEEPALIVE_INTERVAL_MS = 20_000;

  let ws;
  let retryDelay = 1000;
  let keepAliveTimer = null;

  function startKeepAlive() {
    if (keepAliveTimer !== null) return; // already running
    keepAliveTimer = setInterval(() => {
      // Any chrome.* API call resets the service worker idle timer.
      // getPlatformInfo is cheap and has no observable side effects.
      chrome.runtime.getPlatformInfo(() => {});
    }, KEEPALIVE_INTERVAL_MS);
  }

  function stopKeepAlive() {
    if (keepAliveTimer === null) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      console.log("[LWSync] Hot-reload connected");
      retryDelay = 1000;
      startKeepAlive();
    });

    ws.addEventListener("message", async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "reload") {
        console.log("[LWSync] JS changed — reloading extension...");
        // Clear the readiness flag before reloading so any popup that opens
        // immediately after knows to wait for re-initialization.
        await chrome.storage.session.remove("lwsyncBackgroundReady");
        chrome.runtime.reload();
      } else if (msg.type === "css") {
        const popupUrl = chrome.runtime.getURL("popup.html");
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.url?.startsWith(popupUrl) && tab.id != null) {
            chrome.tabs.sendMessage(tab.id, { type: "lwsync-css", css: msg.css })
              .catch(() => {});
          }
        }
      }
    });

    ws.addEventListener("close", () => {
      console.log(\`[LWSync] Disconnected. Retrying in \${retryDelay}ms...\`);
      stopKeepAlive();
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    });

    ws.addEventListener("error", () => {});
  }

  connect();
})();
`;

// ─── Dev code injected into dist/chrome/popup.js ─────────────────────────────

const DEV_POPUP_SNIPPET = `
// ── LWSync CSS Hot-Reload + Background Readiness Guard ──
// (injected by watch.ts — not in source)
(function lwsyncDev() {
  // ── 1. Background readiness guard ─────────────────────────────────────────
  // After a hot-reload, Chrome can make the popup openable before the service
  // worker has finished re-initializing. We poll chrome.storage.session for
  // the readiness flag the background sets at the end of its startup sequence.
  // While waiting we show a subtle overlay so the popup doesn't appear broken.
  const READY_KEY = "lwsyncBackgroundReady";
  const POLL_INTERVAL_MS = 50;
  const POLL_TIMEOUT_MS = 3000;

  async function waitForBackground() {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const result = await chrome.storage.session.get(READY_KEY);
        if (result[READY_KEY]) return true;
      } catch {
        // storage not yet available — keep polling
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    return false; // timed out — proceed anyway rather than hanging forever
  }

  // Overlay the popup with a transparent blocker while we wait. This prevents
  // the user seeing a flash of broken UI state during the cold-start window,
  // and keeps the popup open (visible but non-interactive) rather than closing.
  function showWaitOverlay() {
    const el = document.createElement("div");
    el.id = "lwsync-wait-overlay";
    Object.assign(el.style, {
      position: "fixed", inset: "0", zIndex: "999999",
      background: "transparent", cursor: "wait",
    });
    document.documentElement.appendChild(el);
    return el;
  }

  function removeOverlay(el) {
    el?.remove();
  }

  // Run on DOMContentLoaded so the popup HTML is parsed but before React mounts
  document.addEventListener("DOMContentLoaded", async () => {
    // Fast path: background already ready (normal open, not post-reload)
    try {
      const result = await chrome.storage.session.get(READY_KEY);
      if (result[READY_KEY]) return; // nothing to do
    } catch {}

    // Slow path: we're in the post-reload cold-start window
    console.log("[LWSync] Waiting for background service worker...");
    const overlay = showWaitOverlay();
    const ready = await waitForBackground();
    removeOverlay(overlay);
    if (ready) {
      console.log("[LWSync] Background ready.");
    } else {
      console.warn("[LWSync] Background readiness timed out — proceeding anyway.");
    }
  }, { once: true });

  // ── 2. CSS hot-reload listener ─────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "lwsync-css") return;
    let style = document.getElementById("lwsync-hot-css");
    if (!style) {
      style = document.createElement("style");
      style.id = "lwsync-hot-css";
      const link = document.querySelector('link[rel="stylesheet"]');
      if (link) {
        link.insertAdjacentElement("afterend", style);
        link.disabled = true;
      } else {
        document.head.appendChild(style);
      }
    }
    style.textContent = msg.css;
    console.log("[LWSync] CSS patched in-place");
  });
})();
`;

// ─── Tailwind watch process ───────────────────────────────────────────────────

// Tailwind's --watch mode keeps a warm module graph and reprocesses
// incrementally — far faster than spawning a fresh process per CSS change.
// We read its stdout to detect when a rebuild finishes, then broadcast the
// updated artifact via WebSocket without ever touching the fs.watch CSS path.

let tailwindProc: ReturnType<typeof Bun.spawn> | null = null;

function startTailwindWatch() {
  tailwindProc = Bun.spawn(
    [
      "bunx",
      "@tailwindcss/cli",
      "-i",
      join(SRC, "popup/styles.css"),
      "-o",
      join(DIST_CHROME, "popup.css"),
      "--watch",
      "--minify",
    ],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "inherit",
    }
  );

  // Stream stdout lines — Tailwind v4 prints "Done in Xms" after each rebuild
  // (v3 prints "Done" on a line by itself). We match both.
  (async () => {
    if (!tailwindProc || !(tailwindProc.stdout instanceof ReadableStream))
      return;
    const reader = tailwindProc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);

        if (!line) continue;
        console.log(`[tailwind] ${line}`);

        if (line.toLowerCase().includes("done")) {
          await broadcastCssUpdate();
        }
      }
    }
  })();

  process.on("exit", () => tailwindProc?.kill());
}

async function broadcastCssUpdate() {
  try {
    const css = await Bun.file(join(DIST_CHROME, "popup.css")).text();
    broadcast({ type: "css", css });
  } catch (e) {
    console.error("❌ Failed to read rebuilt CSS:", e);
  }
}

// ─── Build helpers ────────────────────────────────────────────────────────────

// Runs bun build via the programmatic API (Bun.build) rather than spawning a
// `bun build` subprocess via $`...`. Using the subprocess form caused Bun to
// resolve watch.ts itself as the entry point because the shell inherits the
// parent's module loader context. Bun.build() takes an explicit absolute path
// and has no such ambiguity.
async function bundleFile(entry: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: DIST_CHROME,
    target: "browser",
    format: "esm",
    packages: "bundle",
    sourcemap: "inline",
    minify: false,
  });

  if (!result.success) {
    const messages = result.logs.map((l) => l.message).join("\n");
    throw new Error(`Bun.build failed for ${entry}:\n${messages}`);
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

// CSS changes are handled exclusively by the Tailwind --watch subprocess.
// This function is only called for JS and asset changes.
type ChangeKind = "js" | "asset";

async function buildChrome(changedKind: ChangeKind = "js") {
  const start = Date.now();
  const label = { js: "JS", asset: "assets" }[changedKind];
  console.log(`🔨 Building Chrome extension (${label} change)...`);

  try {
    // Ensure output dir exists
    mkdirSync(DIST_CHROME, { recursive: true });

    // 1. Bundle JS using Bun.build() programmatic API — explicit absolute
    //    entry paths mean the bundler cannot confuse watch.ts for background.ts
    await bundleFile(join(SRC, "background.ts"));
    await bundleFile(join(SRC, "popup.tsx"));
    await bundleFile(join(SRC, "darkmode.ts"));

    // 2. CSS is owned by the Tailwind --watch subprocess — do NOT compile here.
    //    On first boot, Tailwind --watch performs an immediate full build before
    //    entering watch mode, so popup.css will exist by the time the extension
    //    loads. The 800ms sleep in the entrypoint ensures this ordering.

    // 3. Copy static assets (HTML, PNG) — only when dest is missing
    for (const entry of readdirSync(ASSETS, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.match(/\.(html|png)$/)) continue;
      const dest = join(DIST_CHROME, entry.name);
      if (!existsSync(dest)) {
        await Bun.write(dest, Bun.file(join(ASSETS, entry.name)));
      }
    }

    // 4. Write dist manifest with dev-only additions injected in-memory —
    //    assets/manifest.json is never modified.
    const packageJson = JSON.parse(
      await Bun.file(join(ROOT, "package.json")).text()
    );
    const manifest = JSON.parse(
      await Bun.file(join(ASSETS, "manifest.json")).text()
    );

    manifest.version = packageJson.version;

    if (!manifest.permissions?.includes("management")) {
      manifest.permissions = [...(manifest.permissions || []), "management"];
    }

    await Bun.write(
      join(DIST_CHROME, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );

    // 5. Append dev snippets to built JS (idempotent — guard strings prevent
    //    double-injection across rebuilds)
    const bgPath = join(DIST_CHROME, "background.js");
    const bgContent = await Bun.file(bgPath).text();
    if (!bgContent.includes("LWSync Dev (injected by watch.ts")) {
      await Bun.write(bgPath, bgContent + "\n" + DEV_BACKGROUND_SNIPPET);
    }

    const popupJsPath = join(DIST_CHROME, "popup.js");
    const popupContent = await Bun.file(popupJsPath).text();
    if (
      !popupContent.includes(
        "LWSync CSS Hot-Reload + Background Readiness Guard"
      )
    ) {
      await Bun.write(popupJsPath, popupContent + "\n" + DEV_POPUP_SNIPPET);
    }

    const duration = Date.now() - start;
    console.log(`✅ Built in ${duration}ms`);

    // Delay the reload signal slightly so Chrome has time to notice the updated
    // files on disk before the service worker calls chrome.runtime.reload().
    // Without this gap, Chrome can reload from the old cached files and the
    // fresh service worker starts in an inconsistent state.
    await Bun.sleep(RELOAD_DELAY_MS);
    broadcast({ type: "reload" });
  } catch (error) {
    console.error(
      "❌ Build failed:",
      error instanceof Error ? error.message : error
    );
  }
}

// ─── File Watchers ────────────────────────────────────────────────────────────

function setupWatchers() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingKind: ChangeKind = "js";

  function scheduleRebuild(filename: string, kind: ChangeKind) {
    console.log(`📝 Changed: ${filename}`);
    if (pendingKind !== "js") pendingKind = kind;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const k = pendingKind;
      debounceTimer = null;
      pendingKind = "js";
      buildChrome(k);
    }, 150);
  }

  watch(SRC, { recursive: true }, (_, filename) => {
    if (!filename) return;
    // CSS changes are handled by the Tailwind --watch subprocess — skip here
    // so we don't trigger a redundant JS rebuild on every .css save.
    if (filename.endsWith(".css")) return;
    if (filename.match(/\.(ts|tsx)$/)) {
      scheduleRebuild(`src/${filename}`, "js");
    }
  });

  watch(ASSETS, { recursive: false }, (_, filename) => {
    if (filename?.match(/\.(json|html|png)$/)) {
      scheduleRebuild(`assets/${filename}`, "asset");
    }
  });

  console.log("📁 Watching: src/ (TS/TSX), assets/");
  console.log(`🎨 Tailwind: watching src/ independently via --watch`);
  console.log(`🔄 Hot-reload: ws://localhost:${WS_PORT}`);
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

// Ensure the output directory exists before Tailwind tries to write into it
mkdirSync(DIST_CHROME, { recursive: true });

// Start Tailwind's own watcher first. It performs an immediate full build on
// startup before entering watch mode, so popup.css will be ready before our
// JS build references it. The sleep below enforces this ordering.
startTailwindWatch();

// Give Tailwind time to complete its initial build before we bundle JS.
// 800ms is conservative — tune down if your Tailwind compile is faster.
await Bun.sleep(800);

await buildChrome("js");
console.log("");
setupWatchers();
process.stdin.resume();
