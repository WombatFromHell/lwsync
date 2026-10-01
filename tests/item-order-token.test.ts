/**
 * Item Order Token Tests
 *
 * Tests for order token format, parsing, and manipulation utilities.
 */

import { describe, it, expect } from "bun:test";
import {
  generateOrderHash,
  formatOrderToken,
  parseOrderToken,
  removeOrderToken,
  appendOrderToken,
  verifyOrderHash,
  getTokenInfo,
} from "../src/sync/item-order-token";

describe("generateOrderHash", () => {
  it("should generate consistent hash for same name", () => {
    const hash1 = generateOrderHash("Test Bookmark");
    const hash2 = generateOrderHash("Test Bookmark");
    expect(hash1).toBe(hash2);
  });

  it("should generate different hashes for different names", () => {
    const hash1 = generateOrderHash("Bookmark A");
    const hash2 = generateOrderHash("Bookmark B");
    expect(hash1).not.toBe(hash2);
  });

  it("should return exactly 8 hex characters", () => {
    const testNames = [
      "Short",
      "Medium Length Name",
      "Very Long Bookmark Name That Should Still Produce 8 Characters",
      "",
      "Special chars: !@#$%",
    ];

    for (const name of testNames) {
      const hash = generateOrderHash(name);
      expect(hash.length).toBe(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should handle empty string", () => {
    const hash = generateOrderHash("");
    expect(hash.length).toBe(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should handle unicode characters", () => {
    const hash1 = generateOrderHash("Bookmark 日本語");
    const hash2 = generateOrderHash("Bookmark 日本語");
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(8);
  });
});

describe("formatOrderToken", () => {
  it("should format token with correct structure", () => {
    const token = formatOrderToken("47b2f5fa", 3);
    expect(token).toBe('[LW:O:{"47b2f5fa":"3"}]');
  });

  it("should handle index 0", () => {
    const token = formatOrderToken("abcd1234", 0);
    expect(token).toBe('[LW:O:{"abcd1234":"0"}]');
  });

  it("should handle large indices", () => {
    const token = formatOrderToken("12345678", 999);
    expect(token).toBe('[LW:O:{"12345678":"999"}]');
  });

  it("should always use lowercase hex", () => {
    const token = formatOrderToken("ABCD1234", 1);
    expect(token).toBe('[LW:O:{"abcd1234":"1"}]');
  });
});

describe("parseOrderToken", () => {
  it("should parse valid token", () => {
    const result = parseOrderToken('[LW:O:{"47b2f5fa":"3"}]');
    expect(result).toEqual({
      hash: "47b2f5fa",
      index: 3,
      token: '[LW:O:{"47b2f5fa":"3"}]',
    });
  });

  it("should parse token with index 0", () => {
    const result = parseOrderToken('[LW:O:{"abcd1234":"0"}]');
    expect(result?.index).toBe(0);
    expect(result?.hash).toBe("abcd1234");
  });

  it("should return null for text without token", () => {
    const result = parseOrderToken("Just a description");
    expect(result).toBeNull();
  });

  it("should return null for malformed token", () => {
    expect(parseOrderToken("[LW:O:invalid]")).toBeNull();
    expect(parseOrderToken('[LW:O:{"xyz":"1"}]')).toBeNull(); // Invalid hex
    expect(parseOrderToken('[LW:O:{"1234":"abc"}]')).toBeNull(); // Invalid index
  });

  it("should parse token embedded in text", () => {
    const result = parseOrderToken(
      'My favorite bookmark [LW:O:{"47b2f5fa":"3"}]'
    );
    expect(result?.hash).toBe("47b2f5fa");
    expect(result?.index).toBe(3);
  });
});

describe("removeOrderToken", () => {
  it("should remove token from description", () => {
    const result = removeOrderToken('My bookmark [LW:O:{"47b2f5fa":"3"}]');
    expect(result).toBe("My bookmark");
  });

  it("should remove token with extra whitespace", () => {
    const result = removeOrderToken('My bookmark   [LW:O:{"47b2f5fa":"3"}]  ');
    expect(result).toBe("My bookmark");
  });

  it("should preserve description without token", () => {
    const result = removeOrderToken("Just a normal description");
    expect(result).toBe("Just a normal description");
  });

  it("should return empty string for token-only input", () => {
    const result = removeOrderToken('[LW:O:{"47b2f5fa":"3"}]');
    expect(result).toBe("");
  });

  it("should handle multiple tokens (remove all)", () => {
    const result = removeOrderToken(
      'Text [LW:O:{"11111111":"1"}] more [LW:O:{"22222222":"2"}]'
    );
    expect(result).toBe("Text more");
  });
});

describe("appendOrderToken", () => {
  it("should append token to description", () => {
    const result = appendOrderToken("My Bookmark", "My Bookmark", 3);
    expect(result).toContain("My Bookmark");
    expect(result).toMatch(/\[LW:O:\{"[a-f0-9]{8}":"3"\}\]/);
  });

  it("should replace existing token", () => {
    const withToken = 'User content [LW:O:{"abcd1234":"0"}]';
    const result = appendOrderToken(withToken, "User content", 5);
    expect(result).toContain("User content");
    expect(result).not.toContain("abcd1234");
    expect(result).toMatch(/\[LW:O:\{"[a-f0-9]{8}":"5"\}\]/);
  });

  it("should preserve user content", () => {
    const result = appendOrderToken(
      "My important bookmark",
      "My important bookmark",
      2
    );
    expect(result).toContain("My important bookmark");
    expect(result).not.toContain("abcd1234");
  });

  it("should handle empty description", () => {
    const result = appendOrderToken("", "Test", 0);
    expect(result).toMatch(/^\[LW:O:\{"[a-f0-9]{8}":"0"\}\]$/);
  });

  it("should generate hash from name", () => {
    const name = "Test Bookmark";
    const expectedHash = generateOrderHash(name);
    const result = appendOrderToken(name, name, 1);
    expect(result).toContain(`"${expectedHash}"`);
  });
});

describe("verifyOrderHash", () => {
  it("should verify matching hash", () => {
    const hash = generateOrderHash("Test Name");
    expect(verifyOrderHash("Test Name", hash)).toBe(true);
  });

  it("should detect rename (hash mismatch)", () => {
    const hash = generateOrderHash("Original Name");
    expect(verifyOrderHash("Renamed Name", hash)).toBe(false);
  });

  it("should handle case sensitivity", () => {
    const hash = generateOrderHash("Test");
    expect(verifyOrderHash("test", hash)).toBe(false);
  });

  it("should handle empty strings", () => {
    const hash = generateOrderHash("");
    expect(verifyOrderHash("", hash)).toBe(true);
    expect(verifyOrderHash("not empty", hash)).toBe(false);
  });
});

describe("getTokenInfo", () => {
  it("should return info for valid token", () => {
    const name = "Test Bookmark";
    const hash = generateOrderHash(name);
    const description = `My bookmark [LW:O:{"${hash}":"3"}]`;

    const info = getTokenInfo(description, name);
    expect(info).toEqual({
      hasToken: true,
      index: 3,
      hashValid: true,
      needsUpdate: false,
    });
  });

  it("should detect invalid hash (rename)", () => {
    const description = 'My bookmark [LW:O:{"abcd1234":"3"}]';
    const newName = "Renamed Bookmark";

    const info = getTokenInfo(description, newName);
    expect(info).toEqual({
      hasToken: true,
      index: 3,
      hashValid: false,
      needsUpdate: true,
    });
  });

  it("should return hasToken: false for no token", () => {
    const info = getTokenInfo("No token here", "Test");
    expect(info).toEqual({ hasToken: false });
  });
});
