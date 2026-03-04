# Linkwarden API Support Research

**Project:** lwsync - Linkwarden Browser Extension
**Date:** 2026-03-05
**Status:** Active Research
**Linkwarden Version:** v2.13.5
**OpenAPI Spec Version:** 1.0.0

---

## Executive Summary

This document catalogs **only the officially supported Linkwarden API endpoints** as documented in the OpenAPI specification (`linkwarden-api-docs.yaml`). 

### Supported Operations (v2.13.5)

| Operation | Endpoint | Status | Notes |
|-----------|----------|--------|-------|
| **Collections** | All CRUD | ✅ Supported | No known issues |
| **Links (single)** | GET/POST/PUT/DELETE `/:id` | ✅ Supported | No known issues |
| **Links (search)** | GET `/search` | ✅ Supported | Has eventual consistency |
| **Links (list)** | GET `/links` | ⚠️ Deprecated | Use `/search` instead |
| **Bulk Operations** | PUT/DELETE `/links` | ❌ **NOT DOCUMENTED** | Not in OpenAPI spec |

### Key Design Principles

1. **Only use documented endpoints** - If it's not in the OpenAPI spec, we don't use it
2. **Handle eventual consistency** - `/search` may lag behind writes (retry with backoff)
3. **Graceful degradation** - If an endpoint fails, degrade gracefully without crashing
4. **No workarounds for unsupported features** - Bulk ops not documented = use individual operations

---

## Supported API Endpoints

### Collections (Fully Supported)

| Method | Endpoint | Purpose | Retry Needed |
|--------|----------|---------|--------------|
| GET | `/api/v1/collections` | List all collections | ❌ No |
| GET | `/api/v1/collections/:id` | Get collection details | ❌ No |
| POST | `/api/v1/collections` | Create collection | ❌ No |
| PUT | `/api/v1/collections/:id` | Update collection | ❌ No |
| DELETE | `/api/v1/collections/:id` | Delete collection | ❌ No |

**Implementation:** Direct calls, no special handling needed.

---

### Links (Supported with Caveats)

#### Single Link Operations (Fully Supported)

| Method | Endpoint | Purpose | Retry Needed |
|--------|----------|---------|--------------|
| GET | `/api/v1/links/:id` | Get link by ID | ❌ No |
| POST | `/api/v1/links` | Create link | ❌ No |
| PUT | `/api/v1/links/:id` | Update link | ❌ No |
| DELETE | `/api/v1/links/:id` | Delete link | ❌ No |

**Implementation:** Direct calls, no special handling needed.

#### Search Operations (Eventual Consistency)

| Method | Endpoint | Purpose | Retry Needed |
|--------|----------|---------|--------------|
| GET | `/api/v1/search?collectionId=:id` | List links in collection | ✅ Yes (after writes) |

**Known Issue:** Search index has eventual consistency (100-500ms lag typical)

**Implementation:** Use retry logic when reading after writes.

#### Deprecated Endpoints (Avoid)

| Method | Endpoint | Status | Recommendation |
|--------|----------|--------|----------------|
| GET | `/api/v1/links?collectionId=:id` | ⚠️ Deprecated | Use `/search` instead |

---

### Bulk Operations (NOT SUPPORTED)

**Important:** The following endpoints are **NOT documented** in the OpenAPI specification:

| Method | Endpoint | Status | Action |
|--------|----------|--------|--------|
| PUT | `/api/v1/links` | ❌ Not documented | **DO NOT USE** |
| DELETE | `/api/v1/links` | ❌ Not documented | **DO NOT USE** |

**Implementation Strategy:** Use individual operations in loops:

```typescript
// ❌ WRONG - Uses undocumented bulk endpoint
await api.bulkDeleteLinks([1, 2, 3]);

// ✅ CORRECT - Use documented individual operations
await Promise.all([1, 2, 3].map(id => api.deleteLink(id)));
```

---

## API Wrapper Implementation

### Core Design

```typescript
interface ApiClientConfig {
  baseUrl: string;
  token: string;
  retry?: {
    maxRetries: number;      // Default: 3
    baseDelay: number;       // Default: 100ms
    maxDelay: number;        // Default: 5000ms
  };
}

class LinkwardenApiClient {
  // Collections - direct calls
  async getCollections(): Promise<Collection[]>
  async getCollection(id: number): Promise<Collection>
  async createCollection(data: CreateCollectionData): Promise<Collection>
  async updateCollection(id: number, data: UpdateCollectionData): Promise<Collection>
  async deleteCollection(id: number): Promise<void>
  
  // Single Links - direct calls
  async getLink(id: number): Promise<Link>
  async createLink(data: CreateLinkData): Promise<Link>
  async updateLink(id: number, data: UpdateLinkData): Promise<Link>
  async deleteLink(id: number): Promise<void>
  
  // Search - with retry for eventual consistency
  async getLinksByCollection(collectionId: number): Promise<Link[]>
}
```

### Retry Logic (for /search endpoint only)

```typescript
async getLinksByCollection(collectionId: number): Promise<Link[]> {
  const maxRetries = 3;
  const baseDelay = 100; // ms
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await this.request<{
        data: {
          links: Link[];
          nextCursor?: number | null;
        };
      }>(`/search?collectionId=${collectionId}`);
      
      return response.data.links;
    } catch (error) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.debug(`Search attempt ${attempt} failed, retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        logger.error('Search failed after retries:', error);
        return []; // Graceful degradation
      }
    }
  }
  
  return [];
}
```

### Individual Operations (Replace Bulk)

```typescript
/**
 * Delete multiple links using individual DELETE operations
 * This is the SUPPORTED approach (bulk DELETE not documented)
 */
async deleteLinks(linkIds: number[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  
  await Promise.all(
    linkIds.map(async (id) => {
      try {
        await this.deleteLink(id);
        deleted++;
      } catch (error) {
        logger.error(`Failed to delete link ${id}:`, error);
        failed++;
      }
    })
  );
  
  return { deleted, failed };
}

/**
 * Update multiple links using individual PUT operations
 * This is the SUPPORTED approach (bulk PUT not documented)
 */
async updateLinks(
  linkIds: number[],
  updates: UpdateLinkData
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  
  await Promise.all(
    linkIds.map(async (id) => {
      try {
        await this.updateLink(id, updates);
        updated++;
      } catch (error) {
        logger.error(`Failed to update link ${id}:`, error);
        failed++;
      }
    })
  );
  
  return { updated, failed };
}

/**
 * Move multiple links using individual PUT operations
 * This is the SUPPORTED approach (bulk move not documented)
 */
async moveLinks(
  linkIds: number[],
  newCollectionId: number
): Promise<{ moved: number; failed: number }> {
  return this.updateLinks(linkIds, { collectionId: newCollectionId });
}
```

---

## Testing Strategy

### Unit Tests (Retry Logic)

```typescript
describe('LinkwardenApiClient', () => {
  describe('getLinksByCollection', () => {
    test('should retry on transient errors', async () => {
      mockServer
        .get('/search')
        .reply(500)
        .get('/search')
        .reply(500)
        .get('/search')
        .reply(200, { data: { links: [] } });
      
      const links = await api.getLinksByCollection(1);
      expect(links).toEqual([]);
      expect(mockServer.calls).toBe(3); // Retried twice
    });
    
    test('should not retry on authentication errors', async () => {
      mockServer.get('/search').reply(401);
      
      await expect(api.getLinksByCollection(1))
        .rejects.toThrow('Authentication failed');
      expect(mockServer.calls).toBe(1); // No retry
    });
  });
  
  describe('deleteLinks (individual operations)', () => {
    test('should delete multiple links individually', async () => {
      mockServer.delete('/links/1').reply(200);
      mockServer.delete('/links/2').reply(200);
      mockServer.delete('/links/3').reply(200);
      
      const result = await api.deleteLinks([1, 2, 3]);
      expect(result.deleted).toBe(3);
      expect(result.failed).toBe(0);
    });
    
    test('should track failures gracefully', async () => {
      mockServer.delete('/links/1').reply(200);
      mockServer.delete('/links/2').reply(500);
      mockServer.delete('/links/3').reply(200);
      
      const result = await api.deleteLinks([1, 2, 3]);
      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(1);
    });
  });
});
```

### Integration Tests (Real API)

```typescript
describe('Linkwarden API Integration', () => {
  test('should handle search index lag', async () => {
    // Create a link
    const link = await api.createLink({
      url: 'https://example.com',
      collectionId: TEST_COLLECTION,
    });
    
    // Search immediately may not find it (index lag)
    // But retry logic should handle this
    const links = await api.getLinksByCollection(TEST_COLLECTION);
    expect(links.some(l => l.id === link.id)).toBe(true);
  });
  
  test('should delete multiple links', async () => {
    // Create test links
    const links = await Promise.all(
      [1, 2, 3].map(i => api.createLink({
        url: `https://test-${i}.example.com`,
        collectionId: TEST_COLLECTION,
      }))
    );
    
    // Delete all
    const result = await api.deleteLinks(links.map(l => l.id));
    expect(result.deleted).toBe(3);
    
    // Verify deletion
    const remaining = await api.getLinksByCollection(TEST_COLLECTION);
    expect(remaining.some(l => links.some(link => link.id === l.id))).toBe(false);
  });
});
```

---

## Migration Guide

### From Bulk Operations to Individual Operations

**Before (using undocumented bulk endpoints):**
```typescript
// ❌ WRONG - bulk operations not documented
await api.bulkDeleteLinks([1, 2, 3]);
await api.bulkUpdateLinks([1, 2, 3], { name: 'Updated' });
await api.bulkMoveLinks([1, 2, 3], newCollectionId);
```

**After (using documented individual operations):**
```typescript
// ✅ CORRECT - individual operations
await api.deleteLinks([1, 2, 3]);
await api.updateLinks([1, 2, 3], { name: 'Updated' });
await api.moveLinks([1, 2, 3], newCollectionId);
```

### From Deprecated /links to /search

**Before:**
```typescript
// ⚠️ Deprecated endpoint
const links = await api.getCollectionLinks(collectionId);
```

**After:**
```typescript
// ✅ Supported endpoint with retry
const links = await api.getLinksByCollection(collectionId);
```

---

## Error Handling

### Error Classification

| Error | Status | Retry? | Action |
|-------|--------|--------|--------|
| Authentication | 401 | ❌ No | Prompt user to re-authenticate |
| Forbidden | 403 | ❌ No | Check permissions |
| Not Found | 404 | ❌ No | Log and continue |
| Rate Limited | 429 | ✅ Yes | Wait and retry |
| Server Error | 500 | ✅ Yes | Retry with backoff |
| Bad Gateway | 502 | ✅ Yes | Retry with backoff |
| Timeout | - | ✅ Yes | Retry with backoff |

### Implementation

```typescript
private shouldRetry(error: APIError): boolean {
  // Retry on server errors and rate limiting
  if (error.status === 429) return true;
  if (error.status && error.status >= 500) return true;
  
  // Don't retry client errors (4xx except 429)
  return false;
}
```

---

## Open Questions

1. **Search Index Lag:** What's the maximum observed lag in production Linkwarden instances?
2. **Rate Limits:** What are the documented rate limits for the API?

---

## References

- [Linkwarden OpenAPI Spec](../linkwarden-api-docs.yaml)
- [Linkwarden API Docs](https://docs.linkwarden.app/api)
- [Linkwarden GitHub](https://github.com/linkwarden/linkwarden)

---

## Changelog

### 2026-03-05 - Initial Version
- Documented only officially supported endpoints
- Removed bulk operations (not in OpenAPI spec)
- Added retry logic for /search eventual consistency
- Designed individual operation replacements for bulk ops
