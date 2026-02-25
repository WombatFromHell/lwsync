# Linkwarden Browser Extension - Design Document

**Status:** ✅ Core Implementation Complete

A browser extension that bidirectionally syncs a Linkwarden collection (and subcollections) with browser bookmarks. Supports Chrome, Firefox, and Edge.

---

## 1. Overview

**Implementation Status:** Complete and tested (89 tests passing)

| Component | Status |
|-----------|--------|
| One-way sync (Linkwarden → Browser) | ✅ Complete |
| Bidirectional sync | ✅ Complete |
| Conflict resolution (LWW + checksums) | ✅ Complete |
| Subcollection support | ✅ Complete |
| Folder moves (bidirectional) | ✅ Complete |
| Path-based duplicate handling | ✅ Complete |
| Deterministic builds | ✅ Complete |
| Cross-browser support | ⏳ Pending manual testing |

### Linkwarden API
- **Base URL**: `{instance}/api/v1`
- **Auth**: Bearer token (JWT from Settings → Access Tokens)
- **Endpoints**: `GET/POST /collections`, `GET/POST/DELETE /links`, `GET /search`
- **Collection Tree**: `GET /collections/:id` with nested subcollections

### Browser Bookmarks API
- **Supported**: Chrome (MV3), Firefox (WebExtensions), Edge
- **Structure**: Tree via `BookmarkTreeNode` (`id`, `parentId`, `title`, `url`, `children`)
- **Events**: `onCreated`, `onRemoved`, `onChanged`, `onMoved`
- **Permission**: `"bookmarks"` required in manifest

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension                         │
│  ┌─────────────┐  ┌──────────────┐                          │
│  │  Background │  │   Popup UI   │                          │
│  │   Service   │  │  (Settings)  │                          │
│  │   Worker    │  │              │                          │
│  └──────┬──────┘  └──────────────┘                          │
│         │                                                    │
│  ┌──────▼─────────────────────────────────────────────────┐ │
│  │           Sync Engine (Core Logic)                      │ │
│  │  - Change Detection  - Conflict Resolution              │ │
│  │  - Mapping Layer     - Sync Scheduling                  │ │
│  └──────┬─────────────────────────────────────────────────┘ │
│         │                                                    │
│  ┌──────▼──────────────┐  ┌──────────────────────────────┐  │
│  │  chrome.bookmarks   │  │   chrome.storage.local       │  │
│  │       API           │  │   (unlimitedStorage)         │  │
│  └─────────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP REST (Bearer Token)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Linkwarden Server                         │
│  /api/v1/collections, /api/v1/links, /api/v1/search         │
└─────────────────────────────────────────────────────────────┘
```

**Storage:** `chrome.storage.local` with `unlimitedStorage` permission (no quota limits)

---

## 3. Conflict Resolution

**Strategy:** Last-Write-Wins with Checksum Validation

```typescript
function resolveConflict(local: Mapping, remote: LinkwardenItem) {
  if (local.checksum === computeChecksum(remote)) return "no-op";
  if (remote.updatedAt > local.browserUpdatedAt) return "use-remote";
  if (local.browserUpdatedAt > remote.updatedAt) return "use-local";
  return "use-local"; // Timestamp tie: browser wins
}
```

**Rationale:** Simple, debuggable, no dependencies. Checksum prevents unnecessary syncs; timestamps from Linkwarden are reliable; browser wins on ties (user's immediate action).

---

## 4. Sync Algorithm

**Initial Sync:**
1. Fetch target collection + subcollections recursively
2. Create matching browser folder structure
3. Populate `mappings` table
4. Record `lastSyncTime`

**Incremental Sync:**
1. **Detect** - Query Linkwarden + browser, compare via checksums/timestamps
2. **Resolve** - Apply LWW strategy, queue actions
3. **Apply** - Deletions (bottom-up) → Creations (top-down) → Updates
4. **Update** - Refresh mappings table

**Change Detection:**
- **Browser → Linkwarden**: Listen to `chrome.bookmarks.onCreated/Changed/Removed/Moved`
- **Linkwarden → Browser**: Poll on interval (default 5 min), compare `updatedAt`

---

## 5. Technical Stack

| Component | Technology |
|-----------|------------|
| Extension | Manifest V3 (Chrome), WebExtensions (Firefox) |
| Language | TypeScript |
| Storage | `chrome.storage.local` + `unlimitedStorage` |
| Bundler | Bun (`bun build`) |
| Test Runner | Bun test (`bun:test`) |
| UI Framework | Preact (popup) |

---

## 6. Project Structure

```
lwsync/
├── package.json           # Scripts: build, dev, zip, verify, test
├── bunfig.toml            # Bun build config
├── tsconfig.json          # TypeScript config
├── DESIGN.md              # This document
├── MEMORY.md              # Session notes
├── AGENTS.md              # Quick reference
├── assets/
│   ├── manifest.json      # Chrome MV3
│   ├── manifest.firefox.json  # Firefox
│   ├── popup.html         # Settings UI
│   ├── popup.css          # Popup styles
│   └── icon128.png        # Extension icon
├── scripts/
│   ├── build.ts           # Fast local build
│   ├── build-prod.ts      # Containerized reproducible build
│   └── zip.ts             # Package with checksums
├── src/
│   ├── background.ts      # Service worker
│   ├── popup.tsx          # Popup UI (Preact)
│   ├── sync.ts            # Core sync engine
│   ├── storage.ts         # Storage wrapper
│   ├── api.ts             # Linkwarden API client
│   ├── bookmarks.ts       # Bookmarks API wrapper
│   ├── browser.ts         # Browser detection
│   └── logger.ts          # Sync logging
├── tests/
│   ├── sync.test.ts       # Unit tests (pure functions)
│   ├── api.e2e.test.ts    # API E2E (real Linkwarden)
│   ├── sync.integration.test.ts  # Integration tests
│   └── storage.test.ts    # Storage unit tests
└── dist/
    ├── chrome/            # Chrome/Edge build
    └── firefox/           # Firefox build
```

---

## 7. Implementation Status

| Phase | Feature | Status |
|-------|---------|--------|
| **Phase 1** | Foundation (manifest, storage, API client, settings UI) | ✅ Complete |
| **Phase 2** | One-way sync (Linkwarden → Browser) | ✅ Complete |
| **Phase 3** | Bidirectional sync + conflict resolution | ✅ Complete |
| **Phase 4** | Polish (error handling, logging, deduplication, path-based matching) | ✅ Complete |
| **Phase 5** | Build infrastructure (deterministic builds, checksums) | ✅ Complete |
| **Pending** | Cross-browser testing (Chrome, Firefox, Edge) | ⏳ Pending |

---

## 8. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `chrome.storage.local` + `unlimitedStorage` | Simpler than IndexedDB; no quota limits |
| 2 | TDD for core logic | `bun test` for sync engine, conflict resolution |
| 3 | Polling over Webhooks | Linkwarden lacks WebSocket API; polling is reliable |
| 4 | Folder-per-Collection | Maps collections to folders; tags not synced |
| 5 | No content archival | Sync URLs/titles only, not archived content |
| 6 | Single root folder | User selects one collection; subcollections included |
| 7 | Bun for bundling | Fast builds, simple config, no dependencies |
| 8 | Mapping table = source of truth | Never search by name after first sync |
| 9 | Deduplication before creation | Check server/browser before creating |
| 10 | Graceful 409 handling | 409 = expected, create mapping and continue |

---

## 9. Duplicate Handling

**Problem:** Linkwarden, Chrome, and Firefox allow duplicate folder names under the same parent.

**Solution: Three-Tier Strategy**

| Tier | Strategy | Use Case |
|------|----------|----------|
| 1 | **Mapping Table** (primary) | O(1) lookup via `getMappingByLinkwardenId()` |
| 2 | **Name Matching** (fallback) | Check existing folder by name under known parent |
| 3 | **Path-Based Matching** (recovery) | Build path `/Parent/Child/Grandchild` if mappings lost |

**Not Done:**
- ❌ Append IDs to names (ugly: `Resources [12345]`)
- ❌ Index-based matching (fragile)
- ❌ Skip duplicates (data loss)

**Recovery:** `recoverMappings()` scans collections and rebuilds mappings from hierarchy.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Clock skew between browser/server | Use server timestamps as source of truth; add 1-second tolerance |
| Large collections cause timeout | Paginate Linkwarden requests; batch bookmark operations |
| Circular moves in browser | Track move chains; detect loops via `isDescendantOf()` traversal |
| Token expiration | Handle 401 responses; prompt user to refresh token |
| Firefox MV3 compatibility | Test early; use `browser.*` namespace with polyfill |
| Duplicate collection names | Mapping-first strategy; path-based fallback |
| Lost mappings (data corruption) | Recovery utility to rebuild from hierarchy |
| 409 Conflict on link creation | Expected behavior; create mapping instead of error |
| Description field user modification | Move tokens use `{LW:MOVE:...}` format - unlikely to conflict with user text |

---

## 10. Folder Moves

**Token Format:** `{LW:MOVE:{"to":parentId,"ts":timestamp}}`

| Direction | Mechanism |
|-----------|-----------|
| **Browser → Server** | `onMoved` → append token to description → `updateCollection(parentId)` → remove token |
| **Server → Browser** | Detect `parentId` change → `bookmarks.move()` → update mapping |

**Validation:** `isDescendantOf()` prevents circular moves.

**Not Done:**
- ❌ Delete+recreate (loses metadata)
- ❌ Allow circular moves (validated)
- ❌ Modify folder names with IDs

---

## 11. Sync Flow

**User triggers sync → Background worker:**
1. Get pending changes from storage
2. For each change: check server → create/update → store mapping
3. Fetch collection tree from Linkwarden
4. For each link: check mapping → create/update → store mapping
5. Return sync status to popup

**See:** `tests/sync.integration.test.ts` for round-trip sync test scenarios.

---

## 12. Testing

**Rule:** Never mock the system-under-test. Only mock browser APIs that don't exist in test environment.

| Test Type | File | What It Tests | Mocking |
|-----------|------|---------------|---------|
| **Unit** | `tests/sync.test.ts` | Pure functions (conflict, checksums, move tokens) | None |
| **Unit** | `tests/storage.test.ts` | Storage wrapper | `chrome.storage` |
| **API E2E** | `tests/api.e2e.test.ts` | Linkwarden API client | None (real API) |
| **Integration** | `tests/sync.integration.test.ts` | Sync engine round-trip | Browser APIs |

**Run:** `bun test` (all), `bun test tests/sync.test.ts` (unit only)

---

## 13. Deterministic Builds

**Output:** `dist/LWSync-{chrome|firefox}.zip` + `.sha256sum` checksums

| Command | Description |
|---------|-------------|
| `bun run build` | Fast local build (dev) |
| `bun run build:prod` | Containerized reproducible build |
| `bun run zip` | Package with checksums |
| `bun run verify` | Verify archives |
| `bun run verify --compare <d1> <d2>` | Compare for determinism |

**Guarantees:** Sorted files, `SOURCE_DATE_EPOCH` timestamps, consistent permissions (0644/0755), SHA256 checksums.

**Container:** Uses Bun 1.3.9 (locked), bit-identical across machines.

**Why:** Security (verify builds match source), reproducibility, compliance, trust.

---

## 14. Session Notes (MEMORY.md)

**Purpose:** Task-level project notebook for pause/resume without context loss.

**Update When:**
- Ending a session (summarize progress)
- Completing significant tasks
- Discovering important implementation details
- Resolving issues

**Format:** See `MEMORY.md` for current session notes.

---

## 15. Reference

**Related:** `tests/TEST_DESIGN.md` - Test suite design document
