# Test Suite Design Document

**Status:** ✅ Complete (89 tests passing)

Comprehensive test suite for the Linkwarden sync extension using Bun's test runner.

---

## 1. Overview

| Metric | Value |
|--------|-------|
| **Total Tests** | 89 |
| **Test Files** | 4 |
| **Framework** | Bun test (`bun:test`) |
| **Coverage** | Unit, Integration, E2E |

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

| Test Type | Mock Policy |
|-----------|-------------|
| **Unit** | Pure functions only - no mocks |
| **Integration** | Mock browser APIs only (`chrome.*`) |
| **E2E** | No mocks - real Linkwarden API |

**Rationale:** Test business logic in isolation; mock only uncontrollable external dependencies.

---

## 3. Test Suite Structure

```
tests/
├── sync.test.ts              # Unit: Pure functions (conflict, checksums, moves)
├── storage.test.ts           # Unit: Storage wrapper (with chrome.storage mock)
├── api.e2e.test.ts           # E2E: Real Linkwarden API client
└── sync.integration.test.ts  # Integration: Full sync engine round-trips
```

---

## 4. Test Files

### 4.1 `sync.test.ts` - Unit Tests (28 tests)

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
test("returns use-remote when remote is newer", () => {
  const mapping = createMapping(1000, "different");
  const remote = {
    name: "Test",
    url: "https://example.com",
    updatedAt: new Date(2000).toISOString(),
  };
  const result = resolveConflict(mapping, remote);
  expect(result).toBe("use-remote");
});
```

---

### 4.2 `storage.test.ts` - Storage Unit Tests (21 tests)

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

**Mock Policy:** `chrome.storage.local` mocked with in-memory `Record<string, unknown>`.

**Example:**
```typescript
test("should update existing mapping (upsert)", async () => {
  const mapping1 = { id: "mapping-1", checksum: "abc" };
  const mapping2 = { id: "mapping-1", checksum: "updated" };
  await storage.upsertMapping(mapping1);
  await storage.upsertMapping(mapping2);
  const mappings = await storage.getMappings();
  expect(mappings.length).toBe(1);
  expect(mappings[0].checksum).toBe("updated");
});
```

---

### 4.3 `api.e2e.test.ts` - API E2E Tests (8 tests)

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

### 4.4 `sync.integration.test.ts` - Integration Tests (32 tests)

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
- `chrome.storage.local` - In-memory mock
- `chrome.bookmarks` - In-memory tree structure mock

**Example:**
```typescript
test("should handle browser → server folder move using description token", async () => {
  // Create collection and sync
  const collection = await mockApi.createCollection("Test Folder", 1);
  await syncEngine.sync();
  
  // Simulate browser move event
  await storage.addPendingChange({
    id: "move-1",
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

## 5. Test Data Management

### Fixtures

**In-Memory Mocks:**
- `mockStorage: Record<string, unknown>` - Simulates `chrome.storage.local`
- `mockBookmarks: Record<string, BookmarkNode>` - Simulates bookmark tree
- `MockLinkwardenAPI` - Full API implementation with Maps for collections/links

### Cleanup

**Pattern:** `afterEach` hooks reset state:
```typescript
afterEach(() => {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);
  createdLinks = [];
  createdSubCollections = [];
});
```

**E2E Cleanup:** Real API tests delete created resources after each test.

---

## 6. Test Coverage Matrix

| Feature | Unit | Storage | API E2E | Integration |
|---------|------|---------|---------|-------------|
| Checksum computation | ✅ | - | - | - |
| Conflict resolution | ✅ | - | - | ✅ |
| Move token helpers | ✅ | - | - | - |
| Path parsing | ✅ | - | - | - |
| Storage CRUD | - | ✅ | - | ✅ |
| Linkwarden API | - | - | ✅ | - |
| Initial sync | - | - | - | ✅ |
| Incremental sync | - | - | - | ✅ |
| Browser → Server | - | - | - | ✅ |
| Server → Browser | - | - | - | ✅ |
| Subcollections | - | - | - | ✅ |
| Folder moves | - | - | - | ✅ |
| Duplicate handling | - | - | - | ✅ |
| Error handling | - | - | - | ✅ |

---

## 7. Mock Implementations

### 7.1 `MockLinkwardenAPI`

**Features:**
- In-memory collections/links using `Map<number, T>`
- Full CRUD operations
- Recursive `getCollectionTree()` for subcollections
- Parent tracking for folder hierarchy
- Automatic `updatedAt` timestamp generation
- Move token support in `updateCollection()`

**Example Usage:**
```typescript
const mockApi = new MockLinkwardenAPI();
await mockApi.createLink("https://example.com", 1, "Test");
const collection = await mockApi.getCollectionTree(1);
```

### 7.2 Browser API Mocks

**`chrome.storage.local`:**
```typescript
globalThis.chrome = {
  storage: {
    local: {
      get: (keys, callback) => { /* ... */ },
      set: (items, callback) => { /* ... */ },
      getBytesInUse: (callback) => { /* ... */ },
    },
  },
};
```

**`chrome.bookmarks`:**
- Tree structure via `mockBookmarks` map
- Parent-child relationships tracked
- Events (`onCreated`, `onMoved`, etc.) stubbed
- Full CRUD + `move()` + `getTree()`

---

## 8. Test Scenarios

### Critical Paths

| Scenario | Test File | Tests |
|----------|-----------|-------|
| First-time sync | `sync.integration.test.ts` | 2 |
| Bidirectional sync loop | `sync.integration.test.ts` | 10+ |
| Conflict: browser wins | `sync.test.ts`, `sync.integration.test.ts` | 3 |
| Conflict: server wins | `sync.test.ts`, `sync.integration.test.ts` | 2 |
| Folder move (both directions) | `sync.integration.test.ts` | 4 |
| Duplicate folder names | `sync.integration.test.ts` | 2 |
| Lost mapping recovery | `sync.integration.test.ts` | 1 |
| API auth failure | `api.e2e.test.ts` | 1 |
| Storage corruption | `storage.test.ts` | 2 |

### Edge Cases

| Edge Case | Test File |
|-----------|-----------|
| Empty collection | `sync.integration.test.ts` |
| Very old/future timestamps | `sync.test.ts` |
| Exact timestamp tie | `sync.test.ts` |
| Malformed move tokens | `sync.test.ts` |
| Multiple move tokens | `sync.test.ts` |
| Invalid collection ID | `sync.integration.test.ts` |
| Missing sync metadata | `sync.integration.test.ts` |

---

## 9. Running Tests

### Local Development
```bash
# All tests
bun test

# Specific file
bun test tests/sync.test.ts

# Pattern match
bun test -t "conflict"
```

### CI/CD
```bash
# Install + test
bun install
bun test

# With coverage (future)
bun test --coverage
```

### Debugging
```bash
# Verbose output
bun test --verbose

# Specific test
bun test -t "should handle browser → server folder move"
```

---

## 10. Future Enhancements

### Priority: High
- [ ] **Performance tests** - Large collections (1000+ links)
- [ ] **Regression tests** - Known bugs as test cases
- [ ] **Visual regression** - Popup UI testing

### Priority: Medium
- [ ] **Stress tests** - Rapid consecutive syncs
- [ ] **Network failure simulation** - API timeout/retry logic
- [ ] **Concurrent modification** - Simultaneous browser/server changes

### Priority: Low
- [ ] **Accessibility tests** - Popup UI a11y
- [ ] **Cross-browser tests** - Firefox-specific behavior
- [ ] **Load tests** - Storage size limits

---

## 11. Test Quality Guidelines

### Writing New Tests

1. **Name clearly:** `should <action> when <condition>`
2. **Arrange-Act-Assert:** Group setup, execution, verification
3. **One assertion per concept:** Multiple `expect()` OK if related
4. **Cleanup:** Always reset state in `afterEach`
5. **No flaky tests:** Avoid timing-dependent logic

### Test Review Checklist

- [ ] Test name describes behavior
- [ ] Mocks are minimal and focused
- [ ] Cleanup resets all modified state
- [ ] Assertions are specific (not just `toBeTruthy()`)
- [ ] Edge cases are covered
- [ ] Test is deterministic (no randomness/timing)

---

## 12. Related Documents

- `DESIGN.md` - System architecture and design decisions
- `AGENTS.md` - Quick reference for development commands
- `MEMORY.md` - Current session notes and progress
