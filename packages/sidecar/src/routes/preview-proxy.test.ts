import { describe, expect, it } from "bun:test";
import { buildPreviewUpstreamUrl, parsePreviewTargetUrl } from "./preview-proxy.ts";

describe("preview-proxy target hardening", () => {
  it("accepts localhost http targets", () => {
    const target = parsePreviewTargetUrl("http://localhost:9000/pricing?foo=1");
    expect(target).not.toBeNull();
    expect(target?.origin).toBe("http://localhost:9000");
  });

  it("rejects non-localhost targets", () => {
    const target = parsePreviewTargetUrl("https://example.com/pricing");
    expect(target).toBeNull();
  });

  it("rejects non-http protocols", () => {
    const target = parsePreviewTargetUrl("file:///tmp/index.html");
    expect(target).toBeNull();
  });
});

describe("preview-proxy upstream url building", () => {
  it("preserves target path/query on mounted root request", () => {
    const reqUrl = new URL("http://127.0.0.1:62000/preview-proxy/?target=http%3A%2F%2Flocalhost%3A9000%2Fpricing%3Fsource%3Dide");
    const targetBase = new URL("http://localhost:9000/pricing?source=ide");

    const upstream = buildPreviewUpstreamUrl(reqUrl, targetBase);

    expect(upstream.toString()).toBe("http://localhost:9000/pricing?source=ide");
  });

  it("preserves nested proxy path and merges request query params", () => {
    const reqUrl = new URL(
      "http://127.0.0.1:62000/preview-proxy/_next/data/build/pricing.json?target=http%3A%2F%2Flocalhost%3A9000%2Fpricing&x=1"
    );
    const targetBase = new URL("http://localhost:9000/pricing");

    const upstream = buildPreviewUpstreamUrl(reqUrl, targetBase);

    expect(upstream.toString()).toBe("http://localhost:9000/_next/data/build/pricing.json?x=1");
  });
});
