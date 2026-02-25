# Test Suite Design Document

**Status:** ✅ Complete (105 tests passing)
**Last Updated:** 2026-02-25

Comprehensive test suite for the Linkwarden sync extension using Bun's test runner.

---

## 1. Overview

| Metric          | Value                  |
| --------------- | ---------------------- |
| **Total Tests** | 105                    |
| **Test Files**  | 4                      |
| **Framework**   | Bun test (`bun:test`)  |
| **Coverage**    | Unit, Integration, E2E |

**Run Commands:**

```bash
bun test                              # All tests
bun test tests/sync.test.ts           # Unit tests only
bun test tests/storage.test.ts        # Storage tests only
bun test tests/api.e2e.test.ts        # API E2E only
bun test tests/sync.integration.test.ts  # Integration only
```

---

## 2. Test Philosophy

**Golden Rule:** Never mock the system-under-test.

| Test Type       | Mock Policy                         |
| --------------- | ----------------------------------- |
| **Unit**        | Pure functions only - no mocks      |
| **Integration** | Mock browser APIs only (`chrome.*`) |
| **E2E**         | No mocks - real Linkwarden API      |

**Rationale:** Test business logic in isolation; mock only uncontrollable external dependencies.

---

## 3. Test Suite Structure

```
tests/
├── fixtures/               # Test data factories
│   ├── index.ts            # Barrel exports
│   ├── mapping.ts          # Mapping factory
│   ├── metadata.ts         # SyncMetadata factory
│   ├── change.ts           # PendingChange factory
│   ├── collection.ts       # LinkwardenCollection factory
│   ├── link.ts             # LinkwardenLink factory
│   └── bookmark.ts         # BookmarkNode factory
├── mocks/                  # Mock implementations
│   ├── index.ts            # Barrel exports
│   ├── storage.ts          # MockStorage class
│   ├── bookmarks.ts        # MockBookmarks class
│   ├── browser.ts          # Browser mocks coordinator
│   └── linkwarden.ts       # MockLinkwardenAPI class
├── utils/                  # Test utilities
│   ├── index.ts            # Barrel exports
│   ├── generators.ts       # ID/time generators
│   └── cleanup.ts          # Cleanup helpers
├── sync.test.ts            # Unit: Pure functions
├── storage.test.ts         # Unit: Storage wrapper
├── api.e2e.test.ts         # E2E: Real Linkwarden API
└── sync.integration.test.ts # Integration: Full sync engine
```

---

## 4. Test Infrastructure

### 4.1 Factories (`tests/fixtures/`)

**Purpose:** Provide reusable test data creation with sensible defaults.

| Factory         | Functions                                                            | Example                                   |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| `mapping.ts`    | `createMapping()`, `createCollectionMapping()`                       | `createMapping({ linkwardenId: 1 })`      |
| `metadata.ts`   | `createSyncMetadata()`                                               | `createSyncMetadata({ lastSyncTime: 0 })` |
| `change.ts`     | `createChange()`, `updateChange()`, `deleteChange()`, `moveChange()` | `createChange({ type: "create" })`        |
| `collection.ts` | `createCollection()`, `createSubcollection()`                        | `createCollection({ name: "Test" })`      |
| `link.ts`       | `createLink()`, `createLinkWithDetails()`                            | `createLink(1, { url: "https://..." })`   |
| `bookmark.ts`   | `createBookmark()`, `createBookmarkFolder()`                         | `createBookmark({ title: "Test" })`       |

**Example Usage:**

```typescript
import { createMapping } from "./fixtures/mapping";
import { createSyncMetadata } from "./fixtures/metadata";

// Create mapping with defaults, override specific fields
const mapping = createMapping({
  linkwardenId: 1,
  browserId: "bookmark-1",
  checksum: "abc123",
});

// Create sync metadata
const metadata = createSyncMetadata({
  lastSyncTime: 0,
  targetCollectionId: 1,
});
```

### 4.2 Mocks (`tests/mocks/`)

**Purpose:** Provide realistic mock implementations of browser and external APIs.

| Mock            | Class/Function                                 | Description                                   |
| --------------- | ---------------------------------------------- | --------------------------------------------- |
| `storage.ts`    | `MockStorage`                                  | In-memory chrome.storage.local implementation |
| `bookmarks.ts`  | `MockBookmarks`                                | In-memory bookmark tree with event support    |
| `browser.ts`    | `setupBrowserMocks()`, `cleanupBrowserMocks()` | Install/remove all browser mocks              |
| `linkwarden.ts` | `MockLinkwardenAPI`                            | In-memory Linkwarden API implementation       |

**Example Usage:**

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

**Purpose:** Provide common test helpers and generators.

| Utility         | Functions                                                                     | Description               |
| --------------- | ----------------------------------------------------------------------------- | ------------------------- |
| `generators.ts` | `uniqueId()`, `uniqueUrl()`, `uniqueTitle()`, `timestamp()`, `isoTimestamp()` | Generate unique test data |
| `cleanup.ts`    | `clearStorage()`, `clearBookmarks()`, `fullCleanup()`                         | Clean up test state       |

**Example Usage:**

```typescript
import { uniqueUrl, uniqueTitle, timestamp } from "./utils/generators";

// Generate unique test data
const url = uniqueUrl(); // "https://test-123456-abc123.example.com"
const title = uniqueTitle("Test"); // "Test 1234567890"
const now = timestamp(); // Current timestamp
const past = timestamp(-60000); // 1 minute ago
```

---

## 5. Test Files

### 5.1 `sync.test.ts` - Unit Tests (28 tests)

**Purpose:** Test pure functions in isolation.

**What's Tested:**
| Function | Tests | Purpose |
|----------|-------|---------|
| `computeChecksum()` | 5 | Hash generation for change detection |
| `resolveConflict()` | 6 | LWW conflict resolution logic |
| `appendMoveToken()` | 3 | Token creation for folder moves |
| `extractMoveToken()` | 6 | Token parsing from descriptions |
| `removeMoveToken()` | 6 | Token cleanup after moves |
| `parseFolderPath()` | 10 | Path string → array parsing |

**Mock Policy:** None - pure functions only.

**Example:**

```typescript
import { resolveConflict } from "../src/sync";
import { createMapping } from "../fixtures/mapping";

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

### 5.2 `storage.test.ts` - Storage Unit Tests (21 tests)

**Purpose:** Test `chrome.storage.local` wrapper functions.

**What's Tested:**
| Category | Tests | Functions |
|----------|-------|-----------|
| `getAll/saveAll` | 2 | Bulk storage operations |
| Sync Metadata | 3 | `saveSyncMetadata`, `getSyncMetadata` |
| Mappings | 8 | `upsertMapping`, `getMappings`, `getMappingBy*`, `removeMapping` |
| Pending Changes | 4 | `addPendingChange`, `resolvePendingChange`, `cleanupResolvedChanges` |
| Settings | 3 | `saveSettings`, `getSettings`, updates |
| Utilities | 2 | `clearAll`, `getStorageUsage` |

**Mock Policy:** Uses `setupBrowserMocks()` from `tests/mocks/browser`.

**Example:**

```typescript
import { setupBrowserMocks, cleanupBrowserMocks } from "../mocks/browser";
import { createMapping } from "../fixtures/mapping";

let mocks: ReturnType<typeof setupBrowserMocks>;

beforeEach(() => {
  mocks = setupBrowserMocks();
});

afterEach(() => {
  cleanupBrowserMocks();
});

test("should add and retrieve a mapping", async () => {
  const mapping = createMapping({
    linkwardenId: 1,
    browserId: "bookmark-1",
    checksum: "abc123",
  });

  await storage.upsertMapping(mapping);
  const mappings = await storage.getMappings();

  expect(mappings.length).toBe(1);
  expect(mappings[0]).toEqual(mapping);
});
```

---

### 5.3 `api.e2e.test.ts` - API E2E Tests (8 tests)

**Purpose:** Test Linkwarden API client with real server.

**What's Tested:**
| Test | Purpose |
|------|---------|
| Find collection by name | Verify target collection exists |
| Create link | POST `/api/v1/links` |
| Update link | PUT `/api/v1/links/:id` |
| Delete link | DELETE `/api/v1/links/:id` |
| Create/delete subcollection | POST/DELETE `/api/v1/collections` |
| Test connection | Auth validation |
| Invalid credentials | Error handling |
| Fetch collection tree | Recursive collection fetching |

**Mock Policy:** None - real Linkwarden API calls.

**Configuration:** Uses `.env` file for credentials:

```
ENDPOINT=https://your-linkwarden-instance.com
COLLECTION=Bookmarks
```

**Cleanup:** Auto-deletes created links/subcollections in `afterEach`.

---

### 5.4 `sync.integration.test.ts` - Integration Tests (48 tests)

**Purpose:** Test full sync engine with mocked browser APIs.

**What's Tested:**

**Initial Sync (2 tests):**

- Sync links from Linkwarden to browser on first sync
- Handle empty collection gracefully

**Incremental Sync (2 tests):**

- Skip already synced items with no changes
- Update browser bookmark when Linkwarden link changes

**Conflict Resolution (2 tests):**

- Prefer browser changes when browser is newer
- Handle checksum match as no-op

**Error Handling (3 tests):**

- Handle missing sync metadata
- Handle invalid collection ID
- Continue sync even if one link fails

**Round-Trip Scenarios (10+ tests):**

- Browser → Server: Push new bookmarks
- Browser → Server: Update Linkwarden links
- Server → Browser: Detect remote changes
- Delete propagation both directions

**Subcollection Support (5+ tests):**

- Sync nested subcollections
- Handle duplicate folder names using path-based matching
- Verify correct parent-child mappings

**Folder Moves (4 tests):**

- Browser → Server move using description token
- Server → Browser move via `parentId` change
- Circular move prevention
- Token extraction/cleanup

**Mock Policy:**

- `MockLinkwardenAPI` - Full in-memory API implementation
- `chrome.storage.local` - Via `MockStorage` class
- `chrome.bookmarks` - Via `MockBookmarks` class

**Example:**

```typescript
import { setupBrowserMocks, cleanupBrowserMocks } from "../mocks/browser";
import { MockLinkwardenAPI } from "../mocks/linkwarden";

let mocks: ReturnType<typeof setupBrowserMocks>;
let mockApi: MockLinkwardenAPI;
let syncEngine: SyncEngine;

beforeEach(() => {
  mocks = setupBrowserMocks();
  mockApi = new MockLinkwardenAPI();
  syncEngine = new SyncEngine(mockApi as unknown as LinkwardenAPI);
});

afterEach(() => {
  cleanupBrowserMocks();
});

test("should handle browser → server folder move", async () => {
  // Create collection and sync
  const collection = await mockApi.createCollection("Test Folder", 1);
  await syncEngine.sync();

  // Simulate browser move event
  await storage.addPendingChange({
    id: crypto.randomUUID(),
    type: "move",
    source: "browser",
    browserId: "folder-1",
    parentId: "new-parent-id",
    timestamp: Date.now(),
    resolved: false,
  });

  // Sync and verify move token was processed
  await syncEngine.sync();
  const updated = await mockApi.getCollection(collection.id);
  expect(updated.parentId).toBe(1); // New parent
});
```

---

## 6. Test Coverage Matrix

| Feature              | Unit | Storage | API E2E | Integration |
| -------------------- | ---- | ------- | ------- | ----------- |
| Checksum computation | ✅   | -       | -       | -           |
| Conflict resolution  | ✅   | -       | -       | ✅          |
| Move token helpers   | ✅   | -       | -       | -           |
| Path parsing         | ✅   | -       | -       | -           |
| Storage CRUD         | -    | ✅      | -       | ✅          |
| Linkwarden API       | -    | -       | ✅      | -           |
| Initial sync         | -    | -       | -       | ✅          |
| Incremental sync     | -    | -       | -       | ✅          |
| Browser → Server     | -    | -       | -       | ✅          |
| Server → Browser     | -    | -       | -       | ✅          |
| Subcollections       | -    | -       | -       | ✅          |
| Folder moves         | -    | -       | -       | ✅          |
| Duplicate handling   | -    | -       | -       | ✅          |
| Error handling       | -    | -       | -       | ✅          |

---

## 7. Writing New Tests

### 7.1 Test Naming Convention

Use descriptive names that explain the expected behavior:

```typescript
test("should <action> when <condition>", async () => {
  // Test implementation
});

// Examples:
test("should create mapping when link is synced");
test("should skip already synced items with no changes");
test("should prefer browser changes when browser is newer");
```

### 7.2 Test Structure (Arrange-Act-Assert)

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

### 7.3 Using Factories

```typescript
import { createMapping, createCollectionMapping } from "./fixtures/mapping";
import { createLink } from "./fixtures/link";
import { createPendingChange } from "./fixtures/change";

// Basic usage with defaults
const mapping = createMapping();

// Override specific fields
const mapping = createMapping({
  linkwardenId: 42,
  checksum: "custom-checksum",
});

// Use specialized factories
const collectionMapping = createCollectionMapping({ browserId: "folder-1" });
const change = createPendingChange({ type: "update" });
```

### 7.4 Using Mocks

```typescript
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { MockLinkwardenAPI } from "./mocks/linkwarden";

let mocks: ReturnType<typeof setupBrowserMocks>;
let mockApi: MockLinkwardenAPI;

beforeEach(() => {
  // Install mocks
  mocks = setupBrowserMocks();
  mockApi = new MockLinkwardenAPI();
});

afterEach(() => {
  // Cleanup mocks
  cleanupBrowserMocks();
});

// Use mock API
await mockApi.createLink("https://example.com", 1, "Test");

// Use mock browser
const bookmark = await new Promise<chrome.bookmarks.BookmarkTreeNode>(
  (resolve) => {
    chrome.bookmarks.create({ parentId: "2", title: "Test" }, resolve);
  }
);
```

### 7.5 Using Utilities

```typescript
import { uniqueUrl, uniqueTitle, timestamp } from "./utils/generators";

test("should handle unique data", async () => {
  const url = uniqueUrl(); // Unique URL
  const title = uniqueTitle("Test"); // Unique title
  const oldTime = timestamp(-60000); // 1 minute ago

  // Use in test
  await mockApi.createLink(url, 1, title);
});
```

---

## 8. Related Documents

- `PLAN.md` - Test mocks centralization plan
- `DESIGN.md` - System architecture and design decisions
- `AGENTS.md` - Quick reference for development commands
- `MEMORY.md` - Current session notes and progress
