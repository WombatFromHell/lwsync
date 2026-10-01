# AGENTS.md - Project Guidelines

## Tools & Dependencies

| Tool | Purpose | Version |
|------|---------|---------|
| **Bun** | Runtime, bundler, test runner, package manager | 1.3.9 |
| **TypeScript** | Type-safe JavaScript | 5.x |
| **Prettier** | Code formatting | 3.8.1 |
| **ESLint** | Code linting | 10.x |
| **Tailwind CSS** | Utility-first CSS | 4.2.1 |

## Commands

### Quality & Build

```bash
bun install      # Install dependencies
bun run lint     # ESLint + type check
bun run format   # Prettier format
bun run quality  # Lint + format (full quality check)
bun run build    # Build extension to dist/chrome/ and dist/firefox/ (fast, local)
bun run build:prod  # Production build in container (reproducible)
bun run dev      # Watch mode (rebuild on changes, Chrome only)
```

### Testing

```bash
bun test                              # Run all tests (87 tests)
bun test tests/sync.test.ts           # Unit tests: sync engine (38 tests)
bun test tests/item-order-token.test.ts # Unit tests: order tokens (31 tests)
bun test tests/bookmarks.test.ts      # Unit tests: bookmarks wrapper (3 tests)
bun test tests/smoke.test.ts          # E2E tests: real Linkwarden API (~10s)
bun test tests/e2e-advanced.test.ts   # E2E tests: advanced scenarios (~15s)
```

### Packaging

```bash
bun run zip      # Package for distribution
bun run package  # Build + zip in one command
bun run verify   # Verify archive checksums
bun run verify --compare <dir1> <dir2>  # Compare two build dirs for determinism
```

## Project Structure

```
src/       # Source code
assets/    # Manifest files, HTML, icons
scripts/   # Build helper scripts (TypeScript)
dist/      # Build output
  chrome/    # Manifest V3 build for Chrome/Edge
  firefox/   # Manifest V3 build for Firefox
tests/
  fixtures/  # Test data factories (createMapping, createLink, etc.)
  mocks/     # Mock implementations (MockStorage, MockBookmarks, etc.)
  utils/     # Test utilities (uniqueId, uniqueUrl, etc.)
```

## Development Workflow

1. **Code** → Make changes in `src/`
2. **Quality** → `bun run quality` (lint + format)
3. **Build** → `bun run build` (or `bun run dev` for watch)
4. **Test** → `bun test`
5. **Load** → Load `dist/` as unpacked extension in browser
6. **Package** → `bun run zip` for distribution

## Testing

**Test Files:**
| File | Tests | Description |
|------|-------|-------------|
| `tests/sync.test.ts` | 38 | Sync engine (checksums, conflicts, move tokens, paths) |
| `tests/item-order-token.test.ts` | 31 | Order token utilities (hash generation, parsing) |
| `tests/bookmarks.test.ts` | 3 | Bookmarks wrapper |
| `tests/smoke.test.ts` | 8 | E2E tests with real Linkwarden API |
| `tests/e2e-advanced.test.ts` | 7 | Advanced E2E scenarios (conflicts, order preservation) |

**Test Infrastructure:**
- **Factories** (`tests/fixtures/`): `createMapping()`, `createLink()`, `createCollection()`, etc.
- **Mocks** (`tests/mocks/`): `MockStorage`, `MockBookmarks`, `MockLinkwardenAPI`
- **Utilities** (`tests/utils/`): `uniqueId()`, `uniqueUrl()`, `timestamp()`

**Example Test:**
```typescript
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { MockLinkwardenAPI } from "./mocks/linkwarden";
import { createMapping } from "./fixtures/mapping";

let mocks: ReturnType<typeof setupBrowserMocks>;
let mockApi: MockLinkwardenAPI;

beforeEach(() => {
  mocks = setupBrowserMocks();
  mockApi = new MockLinkwardenAPI();
});

afterEach(() => {
  cleanupBrowserMocks();
});

test("should create mapping", async () => {
  const mapping = createMapping({ linkwardenId: 1, browserId: "bookmark-1" });
  await storage.upsertMapping(mapping);
  
  const mappings = await storage.getMappings();
  expect(mappings.length).toBe(1);
});
```

**Rule:** Never mock the system-under-test. Only mock browser APIs that don't exist in test environment.

**Note:** Integration tests are embedded within the E2E test files (`smoke.test.ts` and `e2e-advanced.test.ts`) rather than in a separate file. These tests use mocked browser APIs with either real or mocked Linkwarden API depending on the test section.

## Loading the Extension

**Chrome/Edge:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist/chrome/` folder

**Firefox:**
1. Go to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select `dist/firefox/manifest.json`

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
