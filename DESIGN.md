# Linkwarden Browser Extension - Design Document

**Status:** ✅ Core Implementation Complete | **Tests:** 119 passing

A browser extension that bidirectionally syncs Linkwarden collections with browser bookmarks. Supports Chrome, Firefox, and Edge with Manifest V3.

---

## 1. Overview

### Feature Set

| Feature | Status | Description |
|---------|--------|-------------|
| **Bidirectional Sync** | ✅ | Browser ↔ Linkwarden synchronization |
| **Conflict Resolution** | ✅ | LWW (Last-Write-Wins) with checksum validation |
| **Subcollection Support** | ✅ | Recursive sync of nested collections |
| **Folder Moves** | ✅ | Bidirectional move tracking via tokens |
| **Bookmark Order** | ✅ | Server-side order tokens in description field |
| **Batch Operations** | ✅ | Parallel API calls for efficiency |
| **Deterministic Builds** | ✅ | Reproducible via container |
| **Cross-Browser** | ✅ | Chrome, Firefox 128+, Edge (MV3) |

### Architecture Principles

1. **Mapping-first strategy** - O(1) lookups via ID mapping table
2. **Server-side order** - Order tokens stored in description field
3. **Batch by default** - Parallel operations via `Promise.allSettled()`
4. **Graceful degradation** - Handle API failures without data loss
5. **No quota limits** - `chrome.storage.local` + `unlimitedStorage`

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  Popup UI   │  │   Background │  │   chrome.storage    │ │
│  │  (Preact)   │◄─┤   Service    │◄─┤   (unlimited)       │ │
│  │             │  │   Worker     │  │                     │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────┘ │
│                          │                                    │
│                   ┌──────▼────────┐                          │
│                   │  SyncEngine   │                          │
│                   │  (Orchestrator)                          │
│                   └──────┬────────┘                          │
│      ┌───────────────────┼───────────────────┐               │
│      │                   │                   │               │
│ ┌────▼────┐      ┌──────▼──────┐     ┌──────▼──────┐        │
│ │ Browser │      │   Remote    │     │ Comparator  │        │
│ │ Changes │      │    Sync     │     │             │        │
│ └────┬────┘      └──────┬──────┘     └─────────────┘        │
│      │                  │                                     │
│ ┌────▼──────────────────▼─────┐                              │
│ │     chrome.bookmarks API    │                              │
│ └─────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP REST (Bearer Token)
                           ▼
                  ┌─────────────────┐
                  │  Linkwarden     │
                  │  /api/v1/*      │
                  └─────────────────┘
```

### Core Modules

| Module | Responsibility |
|--------|---------------|
| **SyncEngine** | Orchestrates sync, coordinates modules |
| **BrowserChangeApplier** | Browser → Server (create, update, delete, move) |
| **RemoteSync** | Server → Browser (fetch collection tree, apply changes) |
| **SyncComparator** | Compare browser/server, detect conflicts |
| **SyncInitializer** | First-time setup, collection creation |
| **OrphanCleanup** | Remove deleted items, normalize indices |

---

## 3. Sync Flow

### 3.1 Full Sync Sequence

```
1. Load sync metadata (collection ID, root folder ID, lastSyncTime)
2. Scan for unmapped bookmarks → queue for sync
3. Process pending changes (browser events)
   ├─ Batch link moves by target collection
   ├─ Batch link deletes
   └─ Apply other changes individually
4. Wait 2.5s for search index update (if links created)
5. Fetch collection tree from Linkwarden
6. Sync collections & links to browser
   ├─ Use mapping-first strategy
   ├─ Fallback to path-based matching
   └─ Restore bookmark order via browserIndex
7. Update lastSyncTime
8. Cleanup resolved pending changes
9. Cleanup orphaned mappings (if remote data fetched)
10. Normalize browserIndex after deletions
```

### 3.2 Change Detection

| Direction | Mechanism |
|-----------|-----------|
| **Browser → Server** | Event listeners (`onCreated`, `onChanged`, `onRemoved`, `onMoved`) |
| **Server → Browser** | Poll on interval (default 5 min), compare timestamps |

### 3.3 Conflict Resolution

**Strategy:** Last-Write-Wins with Checksum Validation

```
Conflict Detected
       │
       ▼
Compute remote checksum
       │
       ▼
Checksums match? ──Yes──► No-op (skip sync)
       │
      No
       │
       ▼
Compare timestamps
       │
       ├─ Remote newer ──► Use remote (Linkwarden wins)
       ├─ Browser newer ─► Use browser (Browser wins)
       └─ Tie ───────────► Use browser (user action priority)
```

**Implementation:**
```typescript
function resolveConflict(local, remote) {
  if (local.checksum === remote.checksum) return "no-op";
  if (remote.updatedAt > local.browserUpdatedAt) return "use-remote";
  return "use-local"; // Browser wins on tie
}
```

---

## 4. Data Model

### 4.1 Storage Schema

```typescript
interface Mapping {
  id: string;
  linkwardenType: "link" | "collection";
  linkwardenId: number;
  browserId: string;
  linkwardenUpdatedAt: number;
  browserUpdatedAt: number;
  lastSyncedAt: number;
  checksum: string;
  browserIndex?: number;      // Position in parent (order preservation)
  cachedName?: string;        // For order token hash regeneration
  cachedNameHash?: string;    // 8-char hash for order token
}

interface PendingChange {
  id: string;
  type: "create" | "update" | "delete" | "move";
  source: "browser" | "linkwarden";
  linkwardenId?: number;
  browserId?: string;
  parentId?: number | string;
  index?: number;             // Position for reorder detection
  oldParentId?: number | string;
  oldIndex?: number;
  data?: { url?: string; title?: string };
  timestamp: number;
  resolved: boolean;
}

interface SyncMetadata {
  id: "sync_state";
  lastSyncTime: number;
  syncDirection: "bidirectional" | "to-browser" | "to-linkwarden";
  targetCollectionId: number;
  browserRootFolderId: string;
}
```

### 4.2 Storage Keys

| Key | Type | Description |
|-----|------|-------------|
| `sync_metadata` | `SyncMetadata` | Last sync time, target IDs |
| `mappings` | `Mapping[]` | ID mapping table |
| `pending_changes` | `PendingChange[]` | Browser event queue |
| `settings` | `Settings` | User configuration |
| `sync_log` | `LogEntry[]` | Recent sync activity (max 100) |
| `section_state` | `SectionState` | UI collapse/expand state |

---

## 5. Order Preservation

### 5.1 Server-Side Order Tokens

**Token Format:** `[LW:O:{"47b2f5fa":"3"}]`

```
[LW:O:{"47b2f5fa":"3"}]
 │    │           │
 │    │           └─ Index (0-based position)
 │    └─ Hash (first 4 + last 4 of DJB2 hash)
 └─ Prefix identifier
```

**Full Description Example:**
```
My favorite bookmark [LW:O:{"47b2f5fa":"3"}]
├──────────────────┘ └────────────────────┘
   User content         Order token (preserved)
```

### 5.2 Order Sync Flow

**Browser → Server (Reorder):**
```
1. User drags bookmark → onMoved event fires
2. HandleMove() detects reorder (same parent)
3. Update mapping.browserIndex = newIndex
4. Call api.updateLinkOrder(id, cachedName, newIndex)
5. Server updates description with new token
```

**Server → Browser (Restore):**
```
1. Fetch links from server (with description)
2. Parse order token: getToken(link.description, link.name)
3. Update mapping with browserIndex, cachedName, cachedNameHash
4. restoreOrder() uses browserIndex to reorder browser
```

### 5.3 Order Uniqueness Constraint

**Invariant:** Each item must have unique `browserIndex` within its type.

**Validation Utilities:**
- `validateOrderUniqueness()` - Detect conflicts
- `normalizeOrderIndices()` - Make sequential (0,1,2...)
- `shiftIndicesForInsert()` - Make room for new item
- `compactIndices()` - Remove gaps after deletion

---

## 6. Duplicate Handling

### 6.1 Three-Tier Strategy

| Tier | Strategy | Complexity | Use Case |
|------|----------|------------|----------|
| 1 | **Mapping Table** | O(1) | Primary lookup via `getMappingByLinkwardenId()` |
| 2 | **Name Matching** | O(n) | Fallback: check existing folder by name under parent |
| 3 | **Path-Based** | O(log n) | Recovery: build path `/Parent/Child/Grandchild` |

### 6.2 Duplicate Prevention

**On Link Creation:**
```typescript
// Check if URL already exists in target collection
const existingLinks = await api.getLinksByCollection(collectionId);
const existingLink = existingLinks.find(l => l.url === url);

if (existingLink) {
  // Create mapping instead of duplicate
  await storage.upsertMapping({ linkwardenId: existingLink.id, ... });
  return;
}

// Create new link
const link = await api.createLink(url, collectionId, title);
```

**Recovery:** `recoverMappings()` scans collections and rebuilds mappings from hierarchy.

---

## 7. Folder Moves

### 7.1 Move Token Format

**Token:** `{LW:MOVE:{"to":parentId,"ts":timestamp}}`

| Direction | Mechanism |
|-----------|-----------|
| **Browser → Server** | `onMoved` → append token to description → `updateCollection()` → remove token |
| **Server → Browser** | Detect `parentId` change → `bookmarks.move()` → update mapping |

### 7.2 Move Validation

```typescript
// Prevent circular moves
const isCircular = await isDescendantOf(folderBrowserId, targetParentId);
if (isCircular) {
  logger.warn("Circular move detected, skipping");
  return;
}
```

---

## 8. API Client

### 8.1 Linkwarden Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/collections` | List all collections |
| `GET` | `/collections/:id` | Get collection with links |
| `POST` | `/collections` | Create collection |
| `PUT` | `/collections/:id` | Update collection |
| `DELETE` | `/collections/:id` | Delete collection |
| `GET` | `/links?collectionId=:id&cursor=:n` | Paginated links (direct DB) |
| `POST` | `/links` | Create link |
| `PUT` | `/links/:id` | Update link |
| `DELETE` | `/links/:id` | Delete link |
| `GET` | `/search?searchQueryString=:q` | Search (eventual consistency) |

### 8.2 Retry Logic

**Exponential Backoff:**
```typescript
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw createError(response);
    return response.json();
  } catch (error) {
    if (attempt < maxRetries - 1) {
      await delay(Math.pow(2, attempt) * 1000);
    }
  }
}
```

**Retryable Errors:**
- Network failures
- Server errors (5xx)
- Rate limits (429) with `Retry-After` header

**Non-Retryable:**
- Client errors (4xx) except 429
- Auth errors (401)
- Not found (404)

---

## 9. Technical Stack

| Component | Technology | Version |
|-----------|------------|---------|
| **Extension** | Manifest V3 | Chrome, Firefox 128+, Edge |
| **Language** | TypeScript | 5.x |
| **Runtime** | Bun | 1.3.9 |
| **UI** | Preact | 10.28.4 |
| **Styling** | Tailwind CSS v4 | 4.2.1 |
| **Bundler** | Bun build | Native |
| **Test Runner** | Bun test | `bun:test` |

---

## 10. Project Structure

```
lwsync/
├── src/
│   ├── background.ts          # Service worker (sync scheduling, messaging)
│   ├── api.ts                 # Linkwarden API client
│   ├── bookmarks.ts           # Browser bookmarks wrapper
│   ├── browser.ts             # Browser detection
│   ├── config.ts              # Centralized configuration
│   ├── popup.tsx              # Popup UI (Preact)
│   ├── sync/                  # Sync engine
│   │   ├── engine.ts          # Main orchestrator
│   │   ├── browser-changes.ts # Browser → Server
│   │   ├── remote-sync.ts     # Server → Browser
│   │   ├── comparator.ts      # Change detection
│   │   ├── collections.ts     # Collection sync
│   │   ├── links.ts           # Link sync
│   │   ├── mappings.ts        # Mapping operations
│   │   ├── moves.ts           # Folder move handling
│   │   ├── orphans.ts         # Orphan cleanup
│   │   ├── conflict.ts        # Conflict resolution
│   │   ├── item-order-token.ts# Order token utilities
│   │   └── errorReporter.ts   # Error collection
│   ├── storage/               # Storage wrapper
│   │   ├── main.ts            # Core operations
│   │   ├── batch.ts           # Batch operations
│   │   └── transaction.ts     # Transaction support
│   ├── types/                 # TypeScript types
│   ├── utils/                 # Utilities
│   └── api/errors.ts          # API error classes
├── tests/
│   ├── sync.test.ts           # Pure functions (28 tests)
│   ├── storage.test.ts        # Storage wrapper (21 tests)
│   ├── api.e2e.test.ts        # Real API calls (8 tests)
│   └── sync.integration.test.ts # Full sync engine (62 tests)
└── assets/
    ├── manifest.json          # Chrome MV3 manifest
    ├── manifest.firefox.json  # Firefox MV3 manifest
    └── popup.html             # UI entry point
```

---

## 11. Commands

```bash
# Development
bun install           # Install dependencies
bun run dev           # Watch mode (Chrome only)
bun run build         # Build to dist/ (fast, local)
bun run build:prod    # Production build (container, reproducible)

# Quality
bun run lint          # ESLint + type check
bun run format        # Prettier format
bun run quality       # Lint + format

# Testing
bun test              # Run all tests (119 tests)
bun test tests/sync.test.ts              # Unit: pure functions
bun test tests/storage.test.ts           # Unit: storage wrapper
bun test tests/api.e2e.test.ts           # E2E: real API
bun test tests/sync.integration.test.ts  # Integration: full engine

# Packaging
bun run zip           # Package for distribution
bun run package       # Build + zip
bun run verify        # Verify checksums
```

---

## 12. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `chrome.storage.local` + `unlimitedStorage` | Simpler than IndexedDB, no quota limits |
| 2 | Mapping table = source of truth | O(1) lookups, never search by name after first sync |
| 3 | Polling over Webhooks | Linkwarden lacks WebSocket API |
| 4 | Folder-per-Collection | Maps collections to folders, tags not synced |
| 5 | No content archival | Sync URLs/titles only, not archived content |
| 6 | LWW conflict resolution | Simple, debuggable, no dependencies |
| 7 | Server-side order tokens | Cross-device sync, survives browser reset |
| 8 | Order uniqueness constraint | Prevents duplicate indices, enables reliable restore |
| 9 | Batch API operations | 10x faster than sequential (parallel execution) |
| 10 | Graceful 409 handling | Expected behavior, create mapping and continue |
| 11 | Path-based fallback | Recovery when mappings lost |
| 12 | Move tokens in description | Track folder moves without API support |
| 13 | Centralized configuration | Single source of truth for magic numbers |
| 14 | Error reporter pattern | Collect errors without failing entire sync |
| 15 | Deterministic builds | Reproducible via container |

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Clock skew** | Use server timestamps, add 1-second tolerance |
| **Large collections** | Paginate requests, batch operations |
| **Circular moves** | `isDescendantOf()` validation |
| **Token expiration** | Handle 401, prompt user to refresh |
| **Duplicate collection names** | Mapping-first, path-based fallback |
| **Lost mappings** | Recovery utility to rebuild from hierarchy |
| **409 on link creation** | Expected, create mapping instead of error |
| **Description user modification** | Move tokens use `{LW:MOVE:...}` format (unlikely to conflict) |
| **API eventual consistency** | Wait 2.5s after link creation, use direct DB endpoint |
| **Order token corruption** | Hash validation, automatic regeneration on rename |

---

## 14. Testing Strategy

### Test Pyramid

```
        ╱╲
       ╱  ╲      E2E (8 tests)
      ╱────╲     Real API calls
     ╱      ╲
    ╱────────╲   Integration (62 tests)
   ╱          ╲  Full sync engine with mocks
  ╱────────────╲
 ╱              ╲  Unit (49 tests)
╱────────────────╲  Pure functions, storage wrapper
```

### Test Infrastructure

| Module | Purpose |
|--------|---------|
| **Factories** (`tests/fixtures/`) | `createMapping()`, `createLink()`, `createCollection()` |
| **Mocks** (`tests/mocks/`) | `MockStorage`, `MockBookmarks`, `MockLinkwardenAPI` |
| **Builders** (`tests/builders/`) | Fluent test data builders |
| **Utilities** (`tests/utils/`) | `uniqueId()`, `uniqueUrl()`, `timestamp()` |

**Rule:** Never mock the system-under-test. Only mock browser APIs that don't exist in test environment.

---

## 15. Loading the Extension

**Chrome/Edge:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist/chrome/` folder

**Firefox:**
1. Go to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select `dist/firefox/manifest.json`

---

## 16. Implementation Status

| Phase | Feature | Status | Tests |
|-------|---------|--------|-------|
| **Phase 1** | Foundation (manifest, storage, API, settings) | ✅ | - |
| **Phase 2** | One-way sync (Linkwarden → Browser) | ✅ | - |
| **Phase 3** | Bidirectional sync + conflict resolution | ✅ | 28 + 62 |
| **Phase 4** | Polish (error handling, logging, deduplication) | ✅ | - |
| **Phase 5** | Build infrastructure (deterministic builds) | ✅ | - |
| **Phase 6** | Firefox MV3 migration | ✅ | - |
| **Phase 7** | UI refactoring + Tailwind CSS v4 | ✅ | - |
| **Phase 8** | Test suite consolidation | ✅ | 119 total |
| **Phase 9** | Bookmark order preservation (client-side) | ✅ | 13 order tests |
| **Phase 10** | Optimized fetch + API compliance | ✅ | - |
| **Phase 11** | Server-side order tokens (item-level) | ✅ | Integrated |

---

**Last Updated:** March 2026  
**Version:** 1.0.0
