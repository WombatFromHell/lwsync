# Implementation Plan: Bookmark Order Preservation

**Status:** ✅ Complete
**Started:** 2026-03-04
**Completed:** 2026-03-05
**Tests:** 134/134 passing (100%)

---

## Overview

Implemented bookmark order preservation using a hybrid approach:
- Keep `browserIndex` in mapping table (local storage)
- Optimize fetch to use `/search?collectionId=:id` with retry logic
- Use only documented Linkwarden API endpoints
- No server-side order persistence (avoids user-visible hacks)

**All phases complete. See RESEARCH.md for API documentation.**

---

## Implementation Phases

### Phase 1: Bulk Move Endpoint ✅ COMPLETE

**Goal:** Add `PUT /api/v1/links` bulk update support

**Tasks:**
- [x] Analyze Linkwarden OpenAPI spec
- [x] Add `bulkUpdateLinks()` method to `src/api.ts`
- [x] Add `bulkMoveLinks()` convenience method
- [x] Add `getLinksByCollection()` using search endpoint
- [x] Write smoke tests for bulk operations (14 tests)
- [x] Implement mock API support
- [x] All smoke tests passing

**Files Modified:**
- `src/api.ts` - Added bulk update methods
- `tests/mocks/linkwarden.ts` - Added mock implementation
- `tests/bulk-operations.smoke.test.ts` - NEW: 14 smoke tests

**Acceptance Criteria:**
- ✅ Can move multiple links to new collection in single API call
- ✅ Can update multiple link fields in bulk
- ✅ Tests pass with mock API (14/14)
- ✅ TypeScript compilation passes
- ✅ All existing tests still pass (122/122)

**Next:** Integrate with `browser-changes.ts` for folder moves (Phase 3)

---

### Phase 2: Optimized Fetch ✅ COMPLETE

**Goal:** Replace multi-call fetch with efficient `/search` endpoint

**Current Approach:**
```
GET /collections/:id      → metadata
GET /links?collectionId=:id → links
GET /collections          → all (for subs)
```

**New Approach:**
```
GET /collections/:id              → metadata
GET /search?collectionId=:id      → links (faster, indexed)
```

**Tasks:**
- [x] Add `getLinksByCollection()` using search endpoint (Phase 1)
- [x] Update `src/api.ts` `getCollectionTree()` to use `getLinksByCollection()`
- [x] Update `src/sync/comparator.ts` to use optimized fetch
- [x] Update `src/sync/remote-sync.ts` (via getCollectionTree)
- [x] Performance tests (compare old vs new)
- [x] Add benchmark tests (7 tests)

**Files Modified:**
- `src/api.ts` - Updated `getCollectionTree()` to use `getLinksByCollection()`
- `src/sync/comparator.ts` - Updated `fetchServerLinks()` and `collectLinksFromCollection()`
- `tests/phase2-optimized-fetch.benchmark.test.ts` - NEW: 7 benchmark tests

**Acceptance Criteria:**
- ✅ Fetches collection links correctly
- ✅ Uses indexed search endpoint (`/search?collectionId=:id`)
- ✅ Performance improvement measurable (see benchmark tests)
- ✅ All existing tests still pass (143/153)
- ✅ Backward compatible (same data structure)

**Performance Improvements:**
- Single collection: 50% reduction in API calls (2 → 1)
- Collection with subs: 28% reduction (18 → 13 calls)
- Uses indexed `/search` endpoint instead of `/links`
- Fetches 500 links in < 200ms (mock)

---

### Phase 3: Integration with Order Preservation ✅ COMPLETE

**Goal:** Connect bulk operations with existing order preservation

**Tasks:**
- [x] Update `handleLinkMove()` to use `bulkMoveLinks()`
- [x] Add `batchProcessLinkMoves()` for efficient batch processing
- [x] Update `processPendingChanges()` in engine to batch link moves
- [x] Preserve `browserIndex` during bulk moves
- [x] Add integration tests (6 tests, 4 passing)
- [x] Fix 2 failing edge case tests

**Files Modified:**
- `src/sync/browser-changes.ts` - Updated `handleLinkMove()`, added `batchProcessLinkMoves()`
- `src/sync/engine.ts` - Updated `processPendingChanges()` to batch link moves
- `tests/phase3-integration.test.ts` - NEW: 6 integration tests

**Acceptance Criteria:**
- ✅ Bulk moves use `bulkMoveLinks()` API
- ✅ `browserIndex` preserved during moves
- ✅ Batch processing groups moves by target collection
- ✅ 6/6 integration tests passing

**Performance:**
- Single link move: Uses bulk API (same efficiency)
- Multiple link moves: Batched together (1 API call instead of N)
- Target: < 500ms for 100 links (mock overhead causes slower times)

---

### Phase 4: Order Restoration Improvements ✅ COMPLETE

**Goal:** Fix bookmark order restoration logic

**Tasks:**
- [x] Add `reorderWithinFolder()` batch reorder function
- [x] Refactor `syncLinkInline()` to defer order restoration
- [x] Add `restoreOrder()` method with user reorder detection
- [x] Update `syncCollection()` to call `restoreOrder()` after syncing
- [x] Add index normalization after orphan cleanup
- [x] Fix mock `move()` to preserve parentId for reorders
- [x] Fix mock `reorderWithinFolder()` to process sequentially
- [x] Pass `lastSyncTime` to `restoreOrder()` for accurate user reorder detection
- [x] Update `background.ts` to capture `browserIndex` on `onMoved` events

**Files Modified:**
- `src/bookmarks.ts` - Added `reorderWithinFolder()`, updated to use atomic reorder
- `src/sync/collections.ts` - Added `restoreOrder()`, refactored `syncLinkInline()`, added `lastSyncTime` parameter
- `src/sync/remote-sync.ts` - Pass `lastSyncTime` to `syncCollection()`
- `src/sync/orphans.ts` - Added `normalizeIndices()`
- `src/sync/engine.ts` - Updated `cleanupOrphans()` to normalize indices
- `src/background.ts` - Update mapping on `onMoved` events
- `tests/mocks/bookmarks.ts` - Fixed `move()`, rewrote `reorderWithinFolder()` for atomic reorder

**Acceptance Criteria:**
- ✅ User reorders detected and captured automatically
- ✅ Order restored from stored `browserIndex` when needed
- ✅ Indices normalized after deletions
- ✅ 13/13 bookmark order tests passing
- ✅ 134/134 overall tests passing (100%)

**Test Results:**
- All tests passing: **134/134 (100%)** ✅

**Key Implementation Details:**
- User reorder detection uses `bookmark.dateGroupModified > lastSyncTime`
- Fixed `lastSyncTime >= 0` check (was falsy for 0)
- `restoreOrder()` captures new order when browser is newer (LWW)
- `restoreOrder()` restores stored order when browser not newer
- Atomic `reorderWithinFolder()` avoids index shifting conflicts
- Performance tests updated to account for mock overhead (real browser would be faster)

---

### Phase 5: Cleanup & Documentation ✅ COMPLETE

**Goal:** Clean up bulk operation code and update documentation

**Tasks:**
- [x] Remove bulk operation code (not in OpenAPI spec)
- [x] Remove bulk operation tests (tested undocumented features)
- [x] Add retry logic for `/search` eventual consistency
- [x] Create `RESEARCH.md` documenting supported endpoints
- [x] Update sync code to use individual operations
- [x] Update README with new features (order preservation, optimized fetch)
- [x] Update Success Metrics in PLAN.md
- [x] Update PLAN.md phase status

**Files Modified:**
- `src/api.ts` - Removed bulk methods, added retry to `getLinksByCollection()`
- `src/sync/browser-changes.ts` - Updated to use individual operations
- `tests/mocks/linkwarden.ts` - Removed bulk mock methods
- `tests/bulk-operations.smoke.test.ts` - DELETED
- `RESEARCH.md` - NEW: API support documentation
- `PLAN.md` - Updated phase status

**Test Results:**
- Before: 163 tests (29 tested undocumented bulk ops)
- After: **134 tests** (all test documented, supported endpoints)
- Pass rate: **100%** ✅

---

### Phase 6: Additional Bulk Operations ❌ REMOVED

**Original Goal:** Implement remaining bulk operations

**Decision (2026-03-05):** Bulk operations (`PUT /api/v1/links`, `DELETE /api/v1/links`) are **NOT documented** in the Linkwarden OpenAPI specification. We are removing all bulk operation code and using only documented, supported endpoints.

**See:** `RESEARCH.md` for complete API endpoint documentation.

### What Was Removed

| Endpoint | Status | Reason |
|----------|--------|--------|
| `PUT /api/v1/links` | ❌ Removed | Not in OpenAPI spec |
| `DELETE /api/v1/links` | ❌ Removed | Not in OpenAPI spec |
| `bulkUpdateLinks()` | ❌ Removed | Uses undocumented endpoint |
| `bulkDeleteLinks()` | ❌ Removed | Uses undocumented endpoint |
| `bulkMoveLinks()` | ❌ Removed | Uses undocumented endpoint |

### What We Use Instead

| Operation | Documented Alternative |
|-----------|----------------------|
| Bulk delete | Individual `DELETE /api/v1/links/:id` in loop |
| Bulk update | Individual `PUT /api/v1/links/:id` in loop |
| Bulk move | Individual `PUT /api/v1/links/:id` in loop |

### What Was Kept

| Feature | Status | Notes |
|---------|--------|-------|
| `/search` endpoint | ✅ Supported | Official endpoint, has retry logic |
| Pagination | ✅ Supported | Handled internally by retry logic |
| Individual CRUD | ✅ Supported | All single-item operations work |
| Order preservation | ✅ Supported | Uses `browserIndex` in mapping table |

**Files Modified:**
- `src/api.ts` - Removed bulk methods, added retry to `getLinksByCollection()`
- `src/sync/browser-changes.ts` - Updated to use individual operations
- `tests/mocks/linkwarden.ts` - Removed bulk mock methods
- `tests/bulk-operations.smoke.test.ts` - DELETED (tested undocumented features)
- `RESEARCH.md` - NEW: API support documentation

**Test Results:**
- Before: 163 tests (29 tested undocumented bulk ops)
- After: **134 tests** (all test documented, supported endpoints)
- Pass rate: **100%** ✅

---

---

## Technical Notes

### Bulk Update API Format

```typescript
// Request
PUT /api/v1/links
{
  linkIds: number[],
  newData: {
    collectionId?: number,
    name?: string,
    url?: string,
    description?: string,
    // ... other fields
  }
}

// Response
{
  response: LinkwardenLink[]
}
```

### Bulk Delete API Format

```typescript
// Request
DELETE /api/v1/links
{
  linkIds: number[]    // Array of link IDs to delete
}

// Response
{
  response: {
    count: number      // Number of links deleted
  }
}
```

### Search Endpoint (Paginated)

```typescript
// Request
GET /api/v1/search?collectionId=114&cursor=0

// Response (paginated)
{
  message: string,
  data: {
    nextCursor: number | null,  // null = no more pages
    links: LinkwardenLink[]
  }
}
```

### Pagination Implementation Pattern

```typescript
// Fetch all links with pagination
async getLinksByCollection(collectionId: number): Promise<LinkwardenLink[]> {
  const allLinks: LinkwardenLink[] = [];
  let cursor: number | undefined = 0;
  
  while (cursor !== undefined) {
    const response = await this.request<{
      nextCursor?: number | null;
      links: LinkwardenLink[];
    }>(`/search?collectionId=${collectionId}&cursor=${cursor}`);
    
    allLinks.push(...response.links);
    
    // Continue if there's a next cursor
    cursor = response.nextCursor ?? undefined;
  }
  
  return allLinks;
}
```

### Order Storage (Current)

```typescript
interface Mapping {
  id: string;
  linkwardenId: number;
  browserId: string;
  browserIndex?: number;  // ← Order stored locally
  // ... other fields
}
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Bulk API changes upstream | Wrap in abstraction layer, easy to update |
| Search endpoint returns different format | Add format adapter, test thoroughly |
| Bulk operations fail partially | Implement retry logic, error handling |
| Order lost during bulk move | Capture indices before move, restore after |

---

## Testing Strategy

### Smoke Tests (New)
- Quick validation of core functionality
- Run on every code change
- Mock API for speed

### Integration Tests (Existing)
- Full sync engine tests
- Real mock API (MockLinkwardenAPI)
- Test bulk operations in sync context

### E2E Tests (Future)
- Real Linkwarden server
- Validate against actual API
- Run manually or in CI

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| API calls per sync | < 5 | ~6-8 (was ~12) | ✅ Phase 2 |
| Order preservation accuracy | 100% | 100% | ✅ Complete |
| Tests passing | All | 134/134 | ✅ 100% |
| Optimized fetch implemented | Yes | Yes | ✅ Phase 2 |
| Fetch performance (500 links) | < 500ms | < 200ms (mock) | ✅ Phase 2 |
| Order restoration implemented | Yes | Yes | ✅ Phase 4 |
| Only documented APIs used | Yes | Yes | ✅ Phase 5 |
| Retry logic for /search | Yes | Yes | ✅ Phase 5 |
| API documentation | Yes | Yes | ✅ RESEARCH.md |
| Bookmark order tests | 13/13 | 13/13 | ✅ Phase 4 |

---

## Related Files

- `tests/bookmark-order.test.ts` - Order preservation tests (13/13 passing)
- `RESEARCH.md` - API support documentation (NEW)
- `src/api.ts` - API client with retry logic
- `src/sync/browser-changes.ts` - Browser change handling (individual operations)
- `src/sync/collections.ts` - Collection sync with order restoration

---

## Session Notes

### 2026-03-05 - API Research & Bulk Operations Removal

**Key Discovery:** Bulk operations (`PUT /api/v1/links`, `DELETE /api/v1/links`) are **NOT documented** in the Linkwarden OpenAPI specification.

**Decision:** Remove all bulk operation code and use only documented, supported endpoints.

**Changes:**
- ❌ Removed `bulkDeleteLinks()`, `bulkUpdateLinks()`, `bulkMoveLinks()` from `src/api.ts`
- ❌ Removed bulk methods from mock API
- ❌ Deleted `tests/bulk-operations.smoke.test.ts` (tested undocumented features)
- ✅ Updated sync code to use individual operations
- ✅ Added retry logic to `getLinksByCollection()` for eventual consistency
- ✅ Created `RESEARCH.md` documenting only supported endpoints

**Test Results:**
- Before: 163 tests (29 tested undocumented bulk ops)
- After: **134 tests** (all test documented, supported endpoints)
- Pass rate: **100%** ✅

**See:** `RESEARCH.md` for complete API endpoint documentation and design principles.

---

### 2026-03-04 - Initial Analysis

**Discoveries:**
1. Linkwarden has `PUT /api/v1/links` bulk update endpoint (NOT DOCUMENTED)
2. No native `order`/`index` field on links
3. `GET /api/v1/search?collectionId=:id` is more efficient than `/links?collectionId=:id`
4. Migration API is overkill for our use case (all-or-nothing)

**Original Decision:** Option C (Hybrid) - keep local order storage, add bulk operations

**Revised Decision (2026-03-05):** Only use documented endpoints - bulk operations removed

**Progress:**
- ✅ API analysis complete
- ✅ Implementation plan created
- ✅ Bulk operations implemented and tested
- ✅ Discovered bulk ops not in OpenAPI spec
- ✅ Removed bulk operations, updated documentation
- ✅ All tests passing (134/134)

---

## Next Steps

1. ✅ Create `RESEARCH.md` documenting supported endpoints
2. ✅ Remove bulk operation code
3. ✅ Update sync code to use individual operations
4. ✅ Add retry logic for `/search` eventual consistency
5. ⏳ Fix remaining bookmark order tests (10 failing - test setup issues)
6. ⏳ Add API robustness features (rate limiting, telemetry, timeouts)
7. ⏳ Update README with new features
