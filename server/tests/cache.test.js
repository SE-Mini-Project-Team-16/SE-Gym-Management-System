import { describe, expect, it, vi } from "vitest";
import { createSummaryCache } from "../src/dashboard.js";

describe("bounded summary cache", () => {
  it("coalesces simultaneous requests and separates subjects", async () => {
    const cached = createSummaryCache();
    const load = vi.fn(async () => ({ count: 4 }));
    await Promise.all([cached("member:A", load), cached("member:A", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    await cached("member:B", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache errors and expires summaries", async () => {
    const cached = createSummaryCache({ ttl: 10 });
    await expect(
      cached("a", () => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    expect(await cached("a", async () => 3)).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(await cached("a", async () => 4)).toBe(4);
  });
  it("evicts the oldest key at the configured bound", async () => {
    const cached = createSummaryCache({ maxEntries: 1 });
    await cached("a", async () => 1);
    await cached("b", async () => 2);
    expect(await cached("a", async () => 3)).toBe(3);
  });
});
