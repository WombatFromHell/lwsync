/**
 * Tests for sync engine - conflict resolution and core logic
 */

import { describe, test, expect } from "bun:test";
import {
  computeChecksum,
  resolveConflict,
  appendMoveToken,
  extractMoveToken,
  removeMoveToken,
  parseFolderPath,
} from "../src/sync";
import type { Mapping } from "../src/storage";

describe("computeChecksum", () => {
  test("returns same checksum for same input", () => {
    const item1 = { name: "Test", url: "https://example.com" };
    const item2 = { name: "Test", url: "https://example.com" };

    expect(computeChecksum(item1)).toBe(computeChecksum(item2));
  });

  test("returns different checksum for different name", () => {
    const item1 = { name: "Test", url: "https://example.com" };
    const item2 = { name: "Other", url: "https://example.com" };

    expect(computeChecksum(item1)).not.toBe(computeChecksum(item2));
  });

  test("returns different checksum for different url", () => {
    const item1 = { name: "Test", url: "https://example.com" };
    const item2 = { name: "Test", url: "https://other.com" };

    expect(computeChecksum(item1)).not.toBe(computeChecksum(item2));
  });

  test("handles empty strings", () => {
    expect(() => computeChecksum({ name: "", url: "" })).not.toThrow();
  });

  test("handles undefined values", () => {
    expect(() => computeChecksum({})).not.toThrow();
  });
});

describe("resolveConflict", () => {
  const createMapping = (
    browserUpdatedAt: number,
    checksum: string
  ): Mapping => ({
    id: "test-id",
    linkwardenType: "link",
    linkwardenId: 1,
    browserId: "browser-1",
    linkwardenUpdatedAt: 1000,
    browserUpdatedAt,
    lastSyncedAt: 500,
    checksum,
  });

  test("returns no-op when checksums match", () => {
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(2000).toISOString(),
    };
    const checksum = computeChecksum(remote);
    const mapping = createMapping(1000, checksum);

    const result = resolveConflict(mapping, remote);
    expect(result).toBe("no-op");
  });

  test("returns use-remote when remote is newer", () => {
    const mapping = createMapping(1000, "different");
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(2000).toISOString(), // Newer
    };

    const result = resolveConflict(mapping, remote);
    expect(result).toBe("use-remote");
  });

  test("returns use-local when browser is newer", () => {
    const mapping = createMapping(3000, "different");
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(2000).toISOString(), // Older
    };

    const result = resolveConflict(mapping, remote);
    expect(result).toBe("use-local");
  });

  test("returns use-local on timestamp tie (browser preference)", () => {
    const mapping = createMapping(2000, "different");
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(2000).toISOString(), // Same time
    };

    const result = resolveConflict(mapping, remote);
    expect(result).toBe("use-local");
  });
});

describe("conflict resolution edge cases", () => {
  test("handles very old timestamps", () => {
    const mapping: Mapping = {
      id: "test-id",
      linkwardenType: "link",
      linkwardenId: 1,
      browserId: "browser-1",
      linkwardenUpdatedAt: 1,
      browserUpdatedAt: 1,
      lastSyncedAt: 1,
      checksum: "abc",
    };
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(0).toISOString(),
    };

    expect(() => resolveConflict(mapping, remote)).not.toThrow();
  });

  test("handles future timestamps", () => {
    const future = Date.now() + 1000000000000;
    const mapping: Mapping = {
      id: "test-id",
      linkwardenType: "link",
      linkwardenId: 1,
      browserId: "browser-1",
      linkwardenUpdatedAt: future,
      browserUpdatedAt: future,
      lastSyncedAt: future,
      checksum: "abc",
    };
    const remote = {
      name: "Test",
      url: "https://example.com",
      updatedAt: new Date(future + 1000).toISOString(),
    };

    expect(() => resolveConflict(mapping, remote)).not.toThrow();
  });
});

describe("Move token helpers", () => {
  describe("appendMoveToken", () => {
    test("appends token to empty description", () => {
      const result = appendMoveToken(undefined, 123);
      expect(result).toContain("{LW:MOVE:");
      expect(result).toContain('"to":123');
      expect(result).toContain('"ts":');
      expect(result).toMatch(/\{LW:MOVE:\{[^}]+\}\}/);
    });

    test("appends token to existing description", () => {
      const result = appendMoveToken("My folder description", 456);
      expect(result).toContain("My folder description");
      expect(result).toContain("{LW:MOVE:");
      expect(result).toContain('"to":456');
      expect(result).toMatch(/\{LW:MOVE:\{[^}]+\}\}/);
    });

    test("includes valid JSON token", () => {
      const result = appendMoveToken(undefined, 789);
      const tokenMatch = result.match(/\{LW:MOVE:(\{[^}]+\})\}/);
      expect(tokenMatch).not.toBeNull();

      const token = JSON.parse(tokenMatch![1]);
      expect(token.to).toBe(789);
      expect(token.ts).toBeGreaterThan(0);
    });
  });

  describe("extractMoveToken", () => {
    test("returns null for undefined description", () => {
      expect(extractMoveToken(undefined)).toBeNull();
    });

    test("returns null for empty description", () => {
      expect(extractMoveToken("")).toBeNull();
    });

    test("returns null for description without token", () => {
      expect(extractMoveToken("Just a normal description")).toBeNull();
    });

    test("extracts valid token", () => {
      const description = 'My folder {LW:MOVE:{"to":123,"ts":1234567890}}';
      const token = extractMoveToken(description);

      expect(token).not.toBeNull();
      expect(token!.to).toBe(123);
      expect(token!.ts).toBe(1234567890);
    });

    test("extracts token from end of description", () => {
      const description =
        'Notes about this folder {LW:MOVE:{"to":456,"ts":9876543210}}';
      const token = extractMoveToken(description);

      expect(token).not.toBeNull();
      expect(token!.to).toBe(456);
    });

    test("returns null for malformed token", () => {
      const description = "{LW:MOVE:{invalid json}}";
      expect(extractMoveToken(description)).toBeNull();
    });

    test("returns null for text containing {LW: but not a valid token", () => {
      const description = "This has {LW:SOMETHING} in it";
      expect(extractMoveToken(description)).toBeNull();
    });
  });

  describe("removeMoveToken", () => {
    test("returns empty string for undefined", () => {
      expect(removeMoveToken(undefined)).toBe("");
    });

    test("returns empty string for empty string", () => {
      expect(removeMoveToken("")).toBe("");
    });

    test("returns original string if no token", () => {
      const original = "Just a normal description";
      expect(removeMoveToken(original)).toBe(original);
    });

    test("removes token from description", () => {
      const withToken = 'My folder {LW:MOVE:{"to":123,"ts":1234567890}}';
      const result = removeMoveToken(withToken);

      expect(result).toBe("My folder");
      expect(result).not.toContain("{LW:MOVE:");
    });

    test("removes token and preserves description", () => {
      const withToken = 'Important notes {LW:MOVE:{"to":456,"ts":9876543210}}';
      const result = removeMoveToken(withToken);

      expect(result).toBe("Important notes");
    });

    test("handles token at start of description", () => {
      const withToken = '{LW:MOVE:{"to":789,"ts":1111111111}} Some notes';
      const result = removeMoveToken(withToken);

      expect(result).toBe("Some notes");
    });

    test("handles multiple tokens (edge case)", () => {
      const withTokens =
        'Text {LW:MOVE:{"to":1,"ts":1}} more {LW:MOVE:{"to":2,"ts":2}}';
      const result = removeMoveToken(withTokens);

      expect(result).toBe("Text more");
    });
  });
});

describe("parseFolderPath", () => {
  test("parses simple single folder name", () => {
    expect(parseFolderPath("Linkwarden")).toEqual(["Linkwarden"]);
  });

  test("parses two-level path", () => {
    expect(parseFolderPath("Bookmarks Menu/Linkwarden")).toEqual([
      "Bookmarks Menu",
      "Linkwarden",
    ]);
  });

  test("parses three-level path", () => {
    expect(parseFolderPath("Other Bookmarks/Work/Projects")).toEqual([
      "Other Bookmarks",
      "Work",
      "Projects",
    ]);
  });

  test("trims whitespace from each part", () => {
    expect(parseFolderPath("  Bookmarks Menu  /  Linkwarden  ")).toEqual([
      "Bookmarks Menu",
      "Linkwarden",
    ]);
  });

  test("filters out empty parts from leading slash", () => {
    expect(parseFolderPath("/Bookmarks Menu/Linkwarden")).toEqual([
      "Bookmarks Menu",
      "Linkwarden",
    ]);
  });

  test("filters out empty parts from trailing slash", () => {
    expect(parseFolderPath("Bookmarks Menu/Linkwarden/")).toEqual([
      "Bookmarks Menu",
      "Linkwarden",
    ]);
  });

  test("filters out empty parts from multiple slashes", () => {
    expect(parseFolderPath("Bookmarks Menu//Linkwarden")).toEqual([
      "Bookmarks Menu",
      "Linkwarden",
    ]);
  });

  test("returns empty array for empty string", () => {
    expect(parseFolderPath("")).toEqual([]);
  });

  test("returns empty array for only slashes", () => {
    expect(parseFolderPath("///")).toEqual([]);
  });

  test("handles folder names with spaces", () => {
    expect(parseFolderPath("My Bookmarks/Work Projects")).toEqual([
      "My Bookmarks",
      "Work Projects",
    ]);
  });
});
