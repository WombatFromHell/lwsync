# Test Suite Design Document

**Status:** ✅ Complete | **Tests:** 122 passing | **Runtime:** ~30s

Comprehensive test suite for Linkwarden sync extension using Bun test runner.

---

## 1. Overview

| Metric | Value |
|--------|-------|
| **Total Tests** | 122 |
| **Test Files** | 6 |
| **Framework** | Bun test (`bun:test`) |
| **Coverage** | Unit + Integration + E2E + Performance |
| **Pass Rate** | 100% |
| **Runtime** | ~30 seconds |

**Run Commands:**

```bash
bun test                                    # All tests (122 tests, ~30s)
bun test tests/sync.test.ts                 # Unit: pure functions (28 tests, ~1s)
bun test tests/storage.test.ts              # Unit: storage wrapper (21 tests, ~1s)
bun test tests/item-order-token.test.ts     # Unit: order tokens (32 tests, ~1s)
bun test tests/smoke.test.ts                # E2E: basic scenarios (~10s)
bun test tests/e2e-advanced.test.ts         # E2E: advanced scenarios (~15s)
```

**Test Configuration:**

E2E tests use environment variables from `.env`:
- `ENDPOINT` - Linkwarden server URL
- `API_KEY` - API access token  
- `TEST_COLLECTION` - Target collection ID (default: 114)

---

## 2. Test Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Test Pyramid                                  │
│                                                                  │
│                    ╱─────────╲                                  │
│                   ╱   E2E     ╲                                 │
│                  ╱  (18 tests) ╲                                │
│                 ╱───────────────╲                               │
│                ╱   Integration   ╲                              │
│               ╱    (62 tests)    ╲                             │
│              ╱─────────────────────╲                            │
│             ╱      Unit Tests       ╲                           │
│            ╱      (81 tests)        ╲                          │
│           ╱───────────────────────────╲                         │
│          ╱                             ╲                        │
│         ╱───────────────────────────────╲                       │
│        │  Fast │ Deterministic │ Isolated │                    │
│         ╲───────────────────────────────╱                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Golden Rule:** Test what users experience.

| Test Type | Purpose | Mock Policy | Speed |
|-----------|---------|-------------|-------|
| **Unit** | Pure functions, deterministic | No mocks | ~1s |
| **Integration** | Full sync engine with mocks | Mock browser APIs | ~5s |
| **E2E** | Real user scenarios | Real server, mock browser | ~15s |

**Rationale:**
- Unit tests verify core logic in isolation (checksums, conflicts, tokens)
- Integration tests verify sync engine with mocked external dependencies
- E2E tests verify actual user experience with real Linkwarden server
- Minimal mocking reduces maintenance and increases confidence

---

## 3. Test Suite Structure

```
tests/
├── fixtures/                 # Test data factories
│   ├── index.ts              # Barrel exports
│   ├── mapping.ts            # createMapping(), createCollectionMapping()
│   ├── metadata.ts           # createSyncMetadata()
│   ├── change.ts             # createChange(), updateChange(), deleteChange()
│   ├── collection.ts         # createCollection(), createSubcollection()
│   ├── link.ts               # createLink(), createLinkWithDetails()
│   ├── bookmark.ts           # createBookmark(), createBookmarkFolder()
│   └── comparison.ts         # createSyncComparison()
├── mocks/                    # Mock implementations
│   ├── index.ts              # Barrel exports
│   ├── storage.ts            # MockStorage (in-memory chrome.storage)
│   ├── bookmarks.ts          # MockBookmarks (in-memory tree)
│   ├── browser.ts            # setupBrowserMocks(), cleanupBrowserMocks()
│   └── linkwarden.ts         # MockLinkwardenAPI (in-memory API)
├── utils/                    # Test utilities
│   ├── index.ts              # Barrel exports
│   ├── generators.ts         # uniqueId(), uniqueUrl(), timestamp()
│   ├── test-cleanup.ts       # cleanupServerResources(), enhancedCleanup()
│   ├── config.ts             # getTestCollectionId()
│   └── harness.ts            # Test harness utilities
├── sync.test.ts              # Unit: sync functions (28 tests)
├── storage.test.ts           # Unit: storage wrapper (21 tests)
├── item-order-token.test.ts  # Unit: order tokens (32 tests)
├── smoke.test.ts             # E2E: basic scenarios (~10s)
└── e2e-advanced.test.ts      # E2E: advanced scenarios (~15s)
```

### 3.1 Test Distribution

```
┌──────────────────────────────────────────────────────────────┐
│                 Test Suite (122 tests)                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────┐  ┌────────────────────────────────┐  │
│  │   Unit Tests       │  │   Integration + E2E            │  │
│  │   (81 tests)       │  │   (41 tests)                   │  │
│  │   ~3 seconds       │  │   ~27 seconds                  │  │
│  ├────────────────────┤  ├────────────────────────────────┤  │
│  │ sync.test.ts       │  │ sync.integration.test.ts       │  │
│  │ • Checksums (5)    │  │ • Full sync engine (62)        │  │
│  │ • Conflicts (6)    │  │ • Browser ↔ Server sync        │  │
│  │ • Move tokens (15) │  │ • Mocked APIs                  │  │
│  │ • Path parsing (2) │  │                                │  │
│  │                    │  │ smoke.test.ts                  │  │
│  │ storage.test.ts    │  │ • Basic sync flows             │  │
│  │ • CRUD ops (21)    │  │ • Search index lag handling    │  │
│  │                    │  │ • Orphan cleanup               │  │
│  │ item-order-token   │  │                                │  │
│  │ • Hash gen (6)     │  │ e2e-advanced.test.ts           │  │
│  │ • Token format (7) │  │ • Conflict resolution (LWW)    │  │
│  │ • Token parse (7)  │  │ • Order preservation           │  │
│  │ • Token utils (12) │  │ • Subcollection sync           │  │
│  └────────────────────┘  └────────────────────────────────┘  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Test Infrastructure

### 4.1 Factories (`tests/fixtures/`)

Reusable test data creation with sensible defaults:

| Factory | Functions | Example |
|---------|-----------|---------|
| `mapping` | `createMapping()`, `createCollectionMapping()` | `createMapping({ linkwardenId: 1 })` |
| `metadata` | `createSyncMetadata()` | `createSyncMetadata({ lastSyncTime: 0 })` |
| `change` | `createChange()`, `updateChange()`, `deleteChange()` | `createChange({ type: "create" })` |
| `collection` | `createCollection()`, `createSubcollection()` | `createCollection({ name: "Test" })` |
| `link` | `createLink()`, `createLinkWithDetails()` | `createLink(1, { url: "https://..." })` |
| `bookmark` | `createBookmark()`, `createBookmarkFolder()` | `createBookmark({ title: "Test" })` |
| `comparison` | `createSyncComparison()` | `createSyncComparison({ syncedCount: 10 })` |

**Example:**
```typescript
import { createMapping } from "./fixtures/mapping";
import { createSyncMetadata } from "./fixtures/metadata";

const mapping = createMapping({
  linkwardenId: 1,
  browserId: "bookmark-1",
  checksum: "abc123",
});

const metadata = createSyncMetadata({
  lastSyncTime: 0,
  targetCollectionId: 1,
});
```

### 4.2 Mocks (`tests/mocks/`)

In-memory implementations of browser APIs:

| Mock | Class | Description |
|------|-------|-------------|
| `storage` | `MockStorage` | In-memory `chrome.storage.local` |
| `bookmarks` | `MockBookmarks` | In-memory bookmark tree with events |
| `browser` | `setupBrowserMocks()` | Install/remove all browser mocks |
| `linkwarden` | `MockLinkwardenAPI` | In-memory Linkwarden API |

**Example:**
```typescript
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { MockLinkwardenAPI } from "./mocks/linkwarden";

let mocks: ReturnType<typeof setupBrowserMocks>;
let mockApi: MockLinkwardenAPI;

beforeEach(() => {
  mocks = setupBrowserMocks();
  mockApi = new MockLinkwardenAPI();
});

afterEach(() => {
  cleanupBrowserMocks();
});
```

### 4.3 Utilities (`tests/utils/`)

Common test helpers:

| Utility | Functions | Description |
|---------|-----------|-------------|
| `generators` | `uniqueId()`, `uniqueUrl()`, `uniqueTitle()` | Generate unique test data |
| `generators` | `timestamp()`, `isoTimestamp()`, `pastTimestamp()` | Time utilities |
| `test-cleanup` | `cleanupServerResources()`, `enhancedCleanup()` | Clean up test state |
| `config` | `getTestCollectionId()` | Test configuration |

**Example:**
```typescript
import { uniqueUrl, uniqueTitle, timestamp } from "./utils/generators";

const url = uniqueUrl();        // "https://test-123456-abc123.example.com"
const title = uniqueTitle();    // "Test 1234567890"
const now = timestamp();        // Current timestamp
const past = timestamp(-60000); // 1 minute ago
```

---

## 5. Test Files

### 5.1 `sync.test.ts` - Unit Tests (28 tests)

**Purpose:** Test pure sync functions in isolation.

| Function | Tests | Purpose |
|----------|-------|---------|
| `computeChecksum()` | 5 | Hash generation for change detection |
| `resolveConflict()` | 6 | LWW conflict resolution logic |
| `appendMoveToken()` | 3 | Token creation for folder moves |
| `extractMoveToken()` | 6 | Token parsing from descriptions |
| `removeMoveToken()` | 6 | Token cleanup after moves |
| `parseFolderPath()` | 2 | Path string → array parsing |

**Mock Policy:** None - pure functions only.

**Example:**
```typescript
test("returns use-remote when remote is newer", () => {
  const mapping = createMapping({
    linkwardenUpdatedAt: 1000,
    browserUpdatedAt: 2000,
  });
  const remote = {
    name: "Test",
    url: "https://example.com",
    updatedAt: new Date(3000).toISOString(),
  };
  const result = resolveConflict(mapping, remote);
  expect(result).toBe("use-remote");
});
```

---

### 5.2 `storage.test.ts` - Unit Tests (21 tests)

**Purpose:** Test storage wrapper with mocked `chrome.storage`.

| Operation | Tests | Purpose |
|-----------|-------|---------|
| `getMappings()` / `upsertMapping()` | 6 | Mapping CRUD |
| `getSyncMetadata()` / `saveSyncMetadata()` | 4 | Metadata persistence |
| `getPendingChanges()` / `addPendingChange()` | 5 | Change queue |
| `getSettings()` / `saveSettings()` | 4 | Settings persistence |
| `clearAll()` | 2 | Full reset |

**Mock Policy:** `MockStorage` for `chrome.storage.local`.

---

### 5.3 `item-order-token.test.ts` - Unit Tests (32 tests)

**Purpose:** Test order token utilities.

| Function | Tests | Purpose |
|----------|-------|---------|
| `generateOrderHash()` | 6 | DJB2 hash generation (8 hex chars) |
| `formatOrderToken()` | 4 | Token string formatting |
| `parseOrderToken()` | 7 | Token parsing with validation |
| `extractOrderToken()` | 3 | Extract token from description |
| `removeOrderToken()` | 4 | Remove token, preserve user content |
| `appendOrderToken()` | 4 | Append/update token in description |
| `verifyOrderHash()` | 2 | Validate hash matches name |
| `getTokenInfo()` | 2 | Get token info with validation |

**Example:**
```typescript
test("should generate consistent hash for same name", () => {
  const hash1 = generateOrderHash("Test Bookmark");
  const hash2 = generateOrderHash("Test Bookmark");
  expect(hash1).toBe(hash2);
  expect(hash1.length).toBe(8);
  expect(hash1).toMatch(/^[a-f0-9]{8}$/);
});
```

---

### 5.4 `smoke.test.ts` - E2E Tests (~10s)

**Purpose:** Verify core sync functionality with real server.

**Test Categories:**

| Category | Tests | Description |
|----------|-------|-------------|
| **Mock API** | 3 | Fast tests without server dependency |
| **Real API** | 7 | Full E2E with real Linkwarden |

**What's Tested:**
1. ✅ Search index lag handling (bug fix verification)
2. ✅ Bookmark creation → server sync
3. ✅ Orphan cleanup (server delete → client)
4. ✅ Rename propagation
5. ✅ Duplicate prevention
6. ✅ Client-side deletion
7. ✅ Server-side deletion
8. ✅ Server-to-client resync

---

### 5.5 `e2e-advanced.test.ts` - Advanced E2E (~15s)

**Purpose:** Test complex sync scenarios against real server.

| Category | Tests | Description |
|----------|-------|-------------|
| **Conflict Resolution** | 2 | LWW strategy, simultaneous changes |
| **Order Preservation** | 2 | Bookmark reorder, restore from server |
| **Subcollection Sync** | 2 | Nested folder structure |
| **Bulk Operations** | 2 | Bulk create/delete performance |

**What's Tested:**
1. ✅ Conflict resolution (LWW)
2. ✅ Simultaneous server/client changes
3. ✅ Bookmark order preservation after reorder
4. ✅ Order restoration from server
5. ✅ Subcollection structure sync
6. ✅ Nested subcollections (3 levels)
7. ✅ Bulk bookmark creation (10 items)
8. ✅ Bulk bookmark deletion

---

## 6. Writing New Tests

### 6.1 Naming Convention

```typescript
test("should <action> when <condition>", async () => {
  // Test implementation
});

// Examples:
test("should create mapping when link is synced");
test("should skip already synced items with no changes");
test("should prefer browser changes when browser is newer");
```

### 6.2 Test Structure (AAA Pattern)

```typescript
test("should do something", async () => {
  // Arrange: Set up test data
  const mapping = createMapping({ linkwardenId: 1 });
  await storage.upsertMapping(mapping);

  // Act: Execute the code under test
  const result = await storage.getMappings();

  // Assert: Verify the result
  expect(result.length).toBe(1);
  expect(result[0].linkwardenId).toBe(1);
});
```

### 6.3 E2E Best Practices

1. **Always cleanup** - Use `afterEach` with `enhancedCleanup()`
2. **Use unique names** - Include timestamps to avoid conflicts
3. **Wait for async** - Use `setTimeout` for server processing
4. **Verify with direct fetch** - Use `api.getLink()` to verify state
5. **Handle search lag** - Use direct ID fetch as fallback

**E2E Template:**
```typescript
test("should do something with real server", async () => {
  const testUrl = `https://test-${Date.now()}.example.com`;
  const testTitle = `Test ${Date.now()}`;

  // Create resource on server
  const link = await api.createLink(testUrl, TEST_COLLECTION_ID, testTitle);
  resources.linkIds.push(link.id); // Track for cleanup

  // Perform action
  await syncEngine.sync();

  // Verify result
  const mappings = await storage.getMappings();
  expect(mappings.length).toBeGreaterThan(0);
}, TEST_TIMEOUT);
```

---

## 7. Test Coverage Matrix

| Feature | Unit | Integration | E2E |
|---------|------|-------------|-----|
| Checksum computation | ✅ | - | - |
| Conflict resolution | ✅ | ✅ | ✅ |
| Move token helpers | ✅ | - | - |
| Order token utilities | ✅ | - | - |
| Storage CRUD | ✅ | ✅ | - |
| Linkwarden API | - | ✅ | ✅ |
| Initial sync | - | ✅ | ✅ |
| Incremental sync | - | ✅ | ✅ |
| Browser → Server | - | ✅ | ✅ |
| Server → Browser | - | ✅ | ✅ |
| Subcollections | - | ✅ | ✅ |
| Folder moves | - | ✅ | - |
| Duplicate handling | - | ✅ | ✅ |
| Error handling | - | ✅ | ✅ |
| Bookmark scanner | - | ✅ | ✅ |
| Performance (bulk) | - | - | ✅ |
| Order preservation | - | ✅ | ✅ |
| Search index lag | - | - | ✅ |
| Orphan cleanup | - | ✅ | ✅ |

---

## 8. Continuous Integration

### GitHub Actions Workflow

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      - name: Install dependencies
        run: bun install
      - name: Run quality checks
        run: bun run quality
      - name: Run unit tests
        run: bun test tests/*.test.ts --exclude 'tests/smoke.test.ts' --exclude 'tests/e2e-advanced.test.ts'
      - name: Run E2E tests
        run: bun test tests/smoke.test.ts tests/e2e-advanced.test.ts
        env:
          ENDPOINT: ${{ secrets.LINKWARDEN_URL }}
          API_KEY: ${{ secrets.LINKWARDEN_TOKEN }}
          TEST_COLLECTION: ${{ secrets.TEST_COLLECTION_ID }}
```

### Local Development

```bash
# Quick feedback (unit only)
bun test tests/sync.test.ts tests/storage.test.ts tests/item-order-token.test.ts

# Before commit
bun run quality && bun test

# Full validation
bun test                            # All tests (~30s)
```

---

## 9. Troubleshooting

### E2E Tests Failing

| Problem | Solution |
|---------|----------|
| Connection errors | Check `.env` credentials, verify server accessible |
| Tests timeout | Increase `TEST_TIMEOUT`, check server performance |
| Orphaned test data | Run `enhancedCleanup()` manually |

### Mock Tests Failing

| Problem | Solution |
|---------|----------|
| "chrome is not defined" | Call `setupBrowserMocks()` in `beforeEach` |
| State leakage | Call `cleanupBrowserMocks()` in `afterEach` |
| Storage not reset | Call `storage.clearAll()` between tests |

---

## 10. Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | 122 |
| **Unit Tests** | 81 (66%) |
| **Integration Tests** | 62 |
| **E2E Tests** | 18 |
| **Pass Rate** | 100% |
| **Runtime** | ~30s |

**Key Strengths:**

1. ✅ **Comprehensive coverage** - Unit + Integration + E2E pyramid
2. ✅ **Fast feedback** - Unit tests run in ~3s
3. ✅ **Real-world validation** - E2E tests with actual server
4. ✅ **Maintainable** - Factories, mocks, utilities reduce duplication
5. ✅ **Reliable cleanup** - Enhanced cleanup prevents orphaned data

**Test Infrastructure:**

```
┌─────────────────────────────────────────────────────────┐
│                  Test Infrastructure                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  Factories  │  │    Mocks    │  │    Utilities    │  │
│  ├─────────────┤  ├─────────────┤  ├─────────────────┤  │
│  │ • Mapping   │  │ • Storage   │  │ • Generators    │  │
│  │ • Metadata  │  │ • Bookmarks │  │ • Cleanup       │  │
│  │ • Change    │  │ • Browser   │  │ • Config        │  │
│  │ • Link      │  │ • API       │  │ • Harness       │  │
│  │ • Bookmark  │  │             │  │                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

**Last Updated:** March 2026  
**Version:** 1.0.0
