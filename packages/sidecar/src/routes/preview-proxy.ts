/**
 * Preview Proxy Route
 *
 * Reverse-proxies the Expo dev server so that an error-catching script can be
 * injected into HTML responses.  This gives the Tauri iframe visibility into
 * runtime JS errors that would otherwise be invisible due to cross-origin
 * restrictions.
 *
 * GET /  ?target=http://localhost:8081
 *        ?target=http://localhost:8081/some/path
 *
 * - HTML responses: injects a <script> that forwards console.error, uncaught
 *   errors, and unhandled rejections to `window.parent.postMessage`.
 * - Non-HTML responses (JS, CSS, images, etc.): passed through unchanged.
 *
 * Sub-resources referenced by relative URLs in the HTML naturally hit this
 * proxy because the iframe's origin is the sidecar.  Absolute URLs pointing at
 * the Expo dev server are rewritten so they also flow through the proxy.
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";

export const previewProxyRouter = new Hono();
const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PREVIEW_SESSION_COOKIE_NAME = "bfloat_preview_session";
const PREVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const PREVIEW_SESSION_MAX_AGE_SECONDS = PREVIEW_SESSION_TTL_MS / 1000;

// ---------------------------------------------------------------------------
// Preview sessions
// ---------------------------------------------------------------------------

export interface PreviewProxySession {
  id: string;
  targetUrl: string;
  targetOrigin: string;
  expiresAt: number;
}

const previewSessions = new Map<string, PreviewProxySession>();

function cleanupExpiredPreviewSessions(now = Date.now()): void {
  for (const [sessionId, session] of previewSessions.entries()) {
    if (session.expiresAt <= now) {
      previewSessions.delete(sessionId);
    }
  }
}

function parseCookieHeader(cookieHeader: string | null | undefined): Map<string, string> {
  const parsed = new Map<string, string>();
  if (!cookieHeader) return parsed;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    parsed.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  return parsed;
}

function getPreviewSessionIdFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  const querySessionId = url.searchParams.get("previewSession");
  if (querySessionId) {
    return querySessionId;
  }

  const cookies = parseCookieHeader(req.headers.get("cookie"));
  return cookies.get(PREVIEW_SESSION_COOKIE_NAME) ?? null;
}

function buildPreviewSessionCookie(sessionId: string): string {
  return [
    `${PREVIEW_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${PREVIEW_SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

function cloneSession(session: PreviewProxySession): PreviewProxySession {
  return {
    id: session.id,
    targetUrl: session.targetUrl,
    targetOrigin: session.targetOrigin,
    expiresAt: session.expiresAt,
  };
}

export function createPreviewProxySession(targetUrl: string): PreviewProxySession | null {
  cleanupExpiredPreviewSessions();

  const parsedTargetUrl = parsePreviewTargetUrl(targetUrl);
  if (!parsedTargetUrl) {
    return null;
  }

  const now = Date.now();
  const session: PreviewProxySession = {
    id: crypto.randomUUID(),
    targetUrl: parsedTargetUrl.toString(),
    targetOrigin: parsedTargetUrl.origin,
    expiresAt: now + PREVIEW_SESSION_TTL_MS,
  };

  previewSessions.set(session.id, session);
  return cloneSession(session);
}

export function getPreviewProxyPath(sessionId: string): string {
  return `/preview-proxy/?previewSession=${encodeURIComponent(sessionId)}`;
}

export function getPreviewProxyWsPath(sessionId: string): string {
  return `/preview-proxy/ws?previewSession=${encodeURIComponent(sessionId)}`;
}

export function getPreviewProxySession(req: Request): PreviewProxySession | null {
  cleanupExpiredPreviewSessions();

  const sessionId = getPreviewSessionIdFromRequest(req);
  if (!sessionId) {
    return null;
  }

  const session = previewSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    previewSessions.delete(sessionId);
    return null;
  }

  return cloneSession(session);
}

export function parsePreviewTargetUrl(rawTarget: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawTarget);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (!LOCAL_PREVIEW_HOSTS.has(parsed.hostname)) {
    return null;
  }

  return parsed;
}

export function buildPreviewUpstreamUrl(reqUrl: URL, targetBaseUrl: URL): URL {
  // Strip the preview-proxy mount prefix before forwarding upstream.
  // e.g. /preview-proxy/_next/static/... -> /_next/static/...
  const requestPath = reqUrl.pathname;
  const proxyPath = requestPath.replace(/^\/preview-proxy(?:\/|$)/, "/");
  const normalizedProxyPath = proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`;
  const isProxyRootRequest = normalizedProxyPath === "/";
  const upstreamPath = isProxyRootRequest
    ? targetBaseUrl.pathname || "/"
    : normalizedProxyPath;

  // Always resolve against the target origin.
  const targetUrl = new URL(upstreamPath, targetBaseUrl.origin);
  // For root preview-proxy requests, preserve target query as upstream baseline.
  if (isProxyRootRequest) {
    targetUrl.search = targetBaseUrl.search;
  }
  // Preserve query params from the original request (except "target"), overriding baseline values.
  reqUrl.searchParams.forEach((value, key) => {
    if (key !== "target") {
      targetUrl.searchParams.set(key, value);
    }
  });

  return targetUrl;
}

function methodSupportsRequestBody(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod !== "GET" && normalizedMethod !== "HEAD";
}

export function createPreviewProxyFetchInit(options: {
  method: string;
  acceptHeader?: string | null;
  contentTypeHeader?: string | null;
  contentLengthHeader?: string | null;
  body?: Uint8Array | ReadableStream;
}): RequestInit {
  const { method, acceptHeader, contentTypeHeader, contentLengthHeader, body } = options;
  const shouldForwardBody = methodSupportsRequestBody(method);

  const headers: Record<string, string> = {
    Accept: acceptHeader || "*/*",
    "Accept-Encoding": "identity",
  };

  if (shouldForwardBody && contentTypeHeader) {
    headers["Content-Type"] = contentTypeHeader;
  }
  if (shouldForwardBody && contentLengthHeader) {
    headers["Content-Length"] = contentLengthHeader;
  }

  const requestInit: RequestInit = {
    method,
    headers,
    redirect: "follow",
  };

  if (shouldForwardBody && body !== undefined) {
    requestInit.body = body;
  }

  return requestInit;
}

async function buildPreviewProxyFetchInit(c: Context): Promise<RequestInit> {
  let body: Uint8Array | undefined;
  let contentLengthHeader = c.req.header("content-length");

  if (methodSupportsRequestBody(c.req.method)) {
    const rawBody = await c.req.raw.arrayBuffer();
    if (rawBody.byteLength > 0) {
      body = new Uint8Array(rawBody);
      contentLengthHeader = String(rawBody.byteLength);
    } else {
      contentLengthHeader = undefined;
    }
  }

  const options: {
    method: string;
    acceptHeader?: string | null;
    contentTypeHeader?: string | null;
    contentLengthHeader?: string | null;
    body?: Uint8Array | ReadableStream;
  } = {
    method: c.req.method,
  };

  const acceptHeader = c.req.header("accept");
  if (acceptHeader !== undefined) {
    options.acceptHeader = acceptHeader;
  }

  const contentTypeHeader = c.req.header("content-type");
  if (contentTypeHeader !== undefined) {
    options.contentTypeHeader = contentTypeHeader;
  }

  if (contentLengthHeader !== undefined) {
    options.contentLengthHeader = contentLengthHeader;
  }

  if (body !== undefined) {
    options.body = body;
  }

  return createPreviewProxyFetchInit(options);
}

// ---------------------------------------------------------------------------
// Injected error-capture script
// ---------------------------------------------------------------------------

const ERROR_CAPTURE_SCRIPT = `<script>
(function() {
  function emitRouteChange() {
    try {
      window.parent.postMessage({
        type: 'bfloat-preview-route',
        path: window.location.pathname + window.location.search + window.location.hash
      }, '*');
    } catch(e) {}
  }

  var normalizedPath = null;
  try {
    var targetParam = new URLSearchParams(window.location.search).get('target');
    if (targetParam) {
      var targetUrl = new URL(targetParam, window.location.origin);
      normalizedPath = (targetUrl.pathname || '/') + targetUrl.search + targetUrl.hash;
    }
  } catch(e) {}
  if (normalizedPath && normalizedPath !== (window.location.pathname + window.location.search + window.location.hash)) {
    history.replaceState(null, '', normalizedPath);
  }
  emitRouteChange();

  var originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    emitRouteChange();
  };
  var originalReplaceState = history.replaceState;
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    emitRouteChange();
  };
  window.addEventListener('popstate', emitRouteChange);

  var origError = console.error;
  console.error = function() {
    origError.apply(console, arguments);
    try {
      var msg = Array.prototype.slice.call(arguments).map(function(a) {
        return typeof a === 'string' ? a : JSON.stringify(a);
      }).join(' ');
      window.parent.postMessage({ type: 'bfloat-preview-error', level: 'error', message: msg }, '*');
    } catch(e) {}
  };
  window.onerror = function(message, source, lineno, colno, error) {
    window.parent.postMessage({
      type: 'bfloat-preview-error',
      level: 'uncaught',
      message: String(message),
      stack: error && error.stack
    }, '*');
  };
  window.addEventListener('unhandledrejection', function(event) {
    window.parent.postMessage({
      type: 'bfloat-preview-error',
      level: 'unhandled-rejection',
      message: String(event.reason),
      stack: event.reason && event.reason.stack
    }, '*');
  });
})();
</script>`;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function handlePreviewProxyRequest(c: Context) {
  const previewSession = getPreviewProxySession(c.req.raw);
  if (!previewSession) {
    return c.json({ error: "Invalid or expired preview session" }, 401);
  }

  let targetUrl: URL;
  const targetBaseUrl = new URL(previewSession.targetUrl);
  const reqUrl = new URL(c.req.url);
  targetUrl = buildPreviewUpstreamUrl(reqUrl, targetBaseUrl);

  // Forward the request to the target.
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), await buildPreviewProxyFetchInit(c));
  } catch (err) {
    return c.json(
      { error: `Failed to reach target: ${err instanceof Error ? err.message : String(err)}` },
      502,
    );
  }

  const contentType = upstream.headers.get("content-type") || "";

  // For HTML responses, inject the error-capture script.
  if (contentType.includes("text/html")) {
    let html = await upstream.text();

    // Rewrite absolute URLs pointing at the target origin so they go through
    // the proxy instead.  This covers src="http://localhost:8081/..." and
    // href="http://localhost:8081/..." patterns.
    const origin = targetUrl.origin; // e.g. "http://localhost:8081"
    // Use a simple global replace — cheaper than parsing HTML.
    html = html.replaceAll(origin + "/", "/");
    html = html.replaceAll(origin, "/");

    // Inject the error-capture script as the first child of <head>.
    const headIdx = html.indexOf("<head>");
    if (headIdx !== -1) {
      html = html.slice(0, headIdx + 6) + ERROR_CAPTURE_SCRIPT + html.slice(headIdx + 6);
    } else {
      // No <head> tag — try <head ...> with attributes
      const headMatch = html.match(/<head[^>]*>/i);
      if (headMatch && headMatch.index !== undefined) {
        const insertAt = headMatch.index + headMatch[0].length;
        html = html.slice(0, insertAt) + ERROR_CAPTURE_SCRIPT + html.slice(insertAt);
      } else {
        // Last resort: prepend to the entire document
        html = ERROR_CAPTURE_SCRIPT + html;
      }
    }

    // Return with appropriate headers.
    return new Response(html, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Set-Cookie": buildPreviewSessionCookie(previewSession.id),
        Vary: "Cookie",
      },
    });
  }

  // Non-HTML: pass through unchanged.
  const responseHeaders = new Headers();
  // Forward content-type and cache headers from upstream.
  if (contentType) responseHeaders.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) responseHeaders.set("Cache-Control", cacheControl);
  responseHeaders.set("Set-Cookie", buildPreviewSessionCookie(previewSession.id));
  responseHeaders.set("Vary", "Cookie");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// Match both mounted root (/preview-proxy) and nested paths
// (/preview-proxy/*) so requests don't leak into the fallback proxy.
previewProxyRouter.all("/", handlePreviewProxyRequest);
previewProxyRouter.all("/*", handlePreviewProxyRequest);

// ---------------------------------------------------------------------------
// Catch-all fallback middleware
// ---------------------------------------------------------------------------
// Sub-resources like `<script src="/entry.bundle">` resolve to the sidecar
// origin and miss the /preview-proxy route entirely.  This middleware catches
// those requests and proxies them to the stored target origin.

export async function previewProxyFallback(c: Context, next: Next) {
  const previewSession = getPreviewProxySession(c.req.raw);
  if (!previewSession) {
    await next();
    return;
  }

  // Build the upstream URL from the stored target + the request path/query.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(c.req.path, previewSession.targetOrigin);
    // Preserve query params from the original request.
    const reqUrl = new URL(c.req.url);
    reqUrl.searchParams.forEach((value, key) => {
      upstreamUrl.searchParams.set(key, value);
    });
  } catch {
    await next();
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), await buildPreviewProxyFetchInit(c));
  } catch {
    // Upstream unreachable — fall through to normal 404.
    await next();
    return;
  }

  // Forward the response.
  const contentType = upstream.headers.get("content-type") || "";
  const responseHeaders = new Headers();
  if (contentType) responseHeaders.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) responseHeaders.set("Cache-Control", cacheControl);
  responseHeaders.set("Set-Cookie", buildPreviewSessionCookie(previewSession.id));
  responseHeaders.set("Vary", "Cookie");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
