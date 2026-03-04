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
bun test                              # Run all tests (119 tests)
bun test tests/sync.test.ts           # Unit tests: pure functions (28 tests)
bun test tests/storage.test.ts        # Unit tests: storage wrapper (21 tests)
bun test tests/api.e2e.test.ts        # E2E tests: real Linkwarden API (8 tests)
bun test tests/sync.integration.test.ts  # Integration tests (62 tests)
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
  builders/  # Test data builders
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
| `tests/sync.test.ts` | 28 | Pure functions (checksums, conflicts, move tokens) |
| `tests/storage.test.ts` | 21 | Storage wrapper with mocked chrome.storage |
| `tests/api.e2e.test.ts` | 8 | Real Linkwarden API calls |
| `tests/sync.integration.test.ts` | 62 | Full sync engine with mocked APIs |

**Test Infrastructure:**
- **Factories** (`tests/fixtures/`): `createMapping()`, `createLink()`, `createCollection()`, etc.
- **Mocks** (`tests/mocks/`): `MockStorage`, `MockBookmarks`, `MockLinkwardenAPI`
- **Builders** (`tests/builders/`): Fluent test data builders
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
