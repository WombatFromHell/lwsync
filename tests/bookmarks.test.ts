/**
 * Unit tests for browser root folder resolution (src/bookmarks.ts)
 *
 * Covers the Chrome/Edge bookmark re-ID bug (crbug 456225717), where the
 * Bookmarks bar no longer has ID "1" and the old ID may point at an
 * unrelated folder.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import * as bookmarks from "../src/bookmarks";

describe("getBrowserRootFolder", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;

  beforeEach(() => {
    mocks = setupBrowserMocks();
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  test("returns the Bookmarks bar when the known ID is present", async () => {
    const root = await bookmarks.getBrowserRootFolder();
    expect(root.id).toBe("1");
  });

  test("falls back to the first root child after a profile re-ID", async () => {
    // Simulate the re-ID bug: the bar gets a new ID at index 0, and the
    // old "1" becomes an unrelated folder under Other Bookmarks.
    const newBar = await mocks.bookmarks.create({
      id: "612",
      parentId: "0",
      index: 0,
      title: "Bookmarks bar",
    });
    await mocks.bookmarks.move("1", { parentId: "2", index: 0 });

    const root = await bookmarks.getBrowserRootFolder();
    expect(root.id).toBe(newBar.id);
  });

  test("throws when the tree has no root folders", async () => {
    await mocks.bookmarks.remove("1");
    await mocks.bookmarks.remove("2");
    await expect(bookmarks.getBrowserRootFolder()).rejects.toThrow(
      "Bookmark tree has no root folders"
    );
  });
});
