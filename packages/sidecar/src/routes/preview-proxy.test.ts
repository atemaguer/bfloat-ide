import { describe, expect, it } from "bun:test";
import {
  buildPreviewUpstreamUrl,
  createPreviewProxyFetchInit,
  createPreviewProxySession,
  getPreviewProxyPath,
  getPreviewProxySession,
  getPreviewProxyWsPath,
  parsePreviewTargetUrl,
} from "./preview-proxy.ts";

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

describe("preview-proxy sessions", () => {
  it("creates a session only for localhost targets", () => {
    const session = createPreviewProxySession("http://localhost:9000/pricing?source=ide");
    expect(session).not.toBeNull();
    expect(session?.targetOrigin).toBe("http://localhost:9000");
    expect(getPreviewProxyPath(session!.id)).toBe(`/preview-proxy/?previewSession=${encodeURIComponent(session!.id)}`);
    expect(getPreviewProxyWsPath(session!.id)).toBe(`/preview-proxy/ws?previewSession=${encodeURIComponent(session!.id)}`);
  });

  it("rejects non-localhost preview sessions", () => {
    const session = createPreviewProxySession("https://example.com");
    expect(session).toBeNull();
  });

  it("resolves preview sessions from query param and cookie", () => {
    const session = createPreviewProxySession("http://127.0.0.1:8081/");
    expect(session).not.toBeNull();

    const queryRequest = new Request(`http://127.0.0.1:7765/preview-proxy/?previewSession=${session!.id}`);
    expect(getPreviewProxySession(queryRequest)?.id).toBe(session!.id);

    const cookieRequest = new Request("http://127.0.0.1:7765/_next/static/chunk.js", {
      headers: {
        cookie: `bfloat_preview_session=${encodeURIComponent(session!.id)}`,
      },
    });
    expect(getPreviewProxySession(cookieRequest)?.id).toBe(session!.id);
  });
});

describe("preview-proxy request forwarding", () => {
  it("forwards JSON body and body headers for POST", () => {
    const body = new ReadableStream();
    const init = createPreviewProxyFetchInit({
      method: "POST",
      acceptHeader: "application/json",
      contentTypeHeader: "application/json",
      contentLengthHeader: "42",
      body,
    });
    const headers = init.headers as Record<string, string>;

    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(headers.Accept).toBe("application/json");
    expect(headers["Accept-Encoding"]).toBe("identity");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Content-Length"]).toBe("42");
  });

  it("does not forward body for GET", () => {
    const body = new ReadableStream();
    const init = createPreviewProxyFetchInit({
      method: "GET",
      acceptHeader: "application/json",
      contentTypeHeader: "application/json",
      contentLengthHeader: "42",
      body,
    });
    const headers = init.headers as Record<string, string>;

    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
    expect(headers["Accept-Encoding"]).toBe("identity");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["Content-Length"]).toBeUndefined();
  });
});
