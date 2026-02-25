# AGENTS.md - Project Guidelines

## Tools & Dependencies

| Tool | Purpose |
|------|---------|
| **Bun** | Runtime, bundler, test runner, package manager |
| **TypeScript** | Type-safe JavaScript |

## Commands

```bash
bun install      # Install dependencies
bun run build    # Build extension to dist/chrome/ and dist/firefox/ (fast, local)
bun run build:prod  # Production build in container (reproducible)
bun run dev      # Watch mode (rebuild on changes, Chrome only)
bun test         # Run all tests (105 tests)
bun test tests/sync.test.ts        # Run unit tests only (28 tests)
bun test tests/storage.test.ts     # Run storage tests only (21 tests)
bun test tests/sync.integration.test.ts  # Run integration tests only (48 tests)
bun test tests/api.e2e.test.ts     # Run E2E tests only (8 tests)
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
  firefox/   # Manifest V2 build for Firefox
tests/
  fixtures/  # Test data factories (createMapping, createLink, etc.)
  mocks/     # Mock implementations (MockStorage, MockBookmarks, etc.)
  utils/     # Test utilities (uniqueId, uniqueUrl, etc.)
```

## Development Workflow

1. **Code** → Make changes in `src/`
2. **Build** → `bun run build` (or `bun run dev` for watch)
3. **Test** → `bun test`
4. **Load** → Load `dist/` as unpacked extension in browser
5. **Package** → `bun run zip` for distribution

## Testing

**Test Files:**
| File | Tests | Description |
|------|-------|-------------|
| `tests/sync.test.ts` | 28 | Pure functions (checksums, conflicts, move tokens) |
| `tests/storage.test.ts` | 21 | Storage wrapper with mocked chrome.storage |
| `tests/api.e2e.test.ts` | 8 | Real Linkwarden API calls |
| `tests/sync.integration.test.ts` | 48 | Full sync engine with mocked APIs |

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
