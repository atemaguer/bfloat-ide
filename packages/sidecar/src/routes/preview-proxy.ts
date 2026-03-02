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

// ---------------------------------------------------------------------------
// Stored proxy target
// ---------------------------------------------------------------------------
// When the initial HTML request arrives with ?target=, we store the origin so
// that subsequent sub-resource requests (which lack the ?target= param) can be
// proxied transparently.

let activeProxyTarget: string | null = null;

export function getActiveProxyTarget(): string | null {
  return activeProxyTarget;
}

// ---------------------------------------------------------------------------
// Injected error-capture script
// ---------------------------------------------------------------------------

const ERROR_CAPTURE_SCRIPT = `<script>
(function() {
  history.replaceState(null, '', '/');
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

previewProxyRouter.all("/*", async (c) => {
  const targetBase = c.req.query("target");
  if (!targetBase) {
    return c.json({ error: "Missing ?target= query parameter" }, 400);
  }

  // Validate target is a localhost URL to prevent open-proxy abuse.
  let targetUrl: URL;
  try {
    // Strip the preview-proxy mount prefix before forwarding upstream.
    // e.g. /preview-proxy/_next/static/... -> /_next/static/...
    const requestPath = new URL(c.req.url).pathname;
    const proxyPath = requestPath.replace(/^\/preview-proxy(?:\/|$)/, "/");
    const upstreamPath = proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`;
    targetUrl = new URL(upstreamPath || "/", targetBase);
    // Preserve query params from the original request (except "target")
    const reqUrl = new URL(c.req.url);
    reqUrl.searchParams.forEach((value, key) => {
      if (key !== "target") {
        targetUrl.searchParams.set(key, value);
      }
    });
  } catch {
    return c.json({ error: "Invalid target URL" }, 400);
  }

  const hostname = targetUrl.hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    return c.json({ error: "Proxy target must be localhost" }, 403);
  }

  // Store the target origin so the catch-all fallback can proxy sub-resources.
  activeProxyTarget = targetUrl.origin;

  // Forward the request to the target.
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: {
        // Forward a minimal set of headers.  Don't forward auth or host.
        "Accept": c.req.header("accept") || "*/*",
        "Accept-Encoding": "identity", // avoid compressed responses we'd have to re-compress
      },
      redirect: "follow",
    });
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
        // Allow the iframe to access parent via postMessage
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Non-HTML: pass through unchanged.
  const responseHeaders = new Headers();
  // Forward content-type and cache headers from upstream.
  if (contentType) responseHeaders.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) responseHeaders.set("Cache-Control", cacheControl);
  responseHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
});

// ---------------------------------------------------------------------------
// Catch-all fallback middleware
// ---------------------------------------------------------------------------
// Sub-resources like `<script src="/entry.bundle">` resolve to the sidecar
// origin and miss the /preview-proxy route entirely.  This middleware catches
// those requests and proxies them to the stored target origin.

export async function previewProxyFallback(c: Context, next: Next) {
  // Only activate when we have a stored target.
  if (!activeProxyTarget) {
    await next();
    return;
  }

  // Build the upstream URL from the stored target + the request path/query.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(c.req.path, activeProxyTarget);
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
    upstream = await fetch(upstreamUrl.toString(), {
      method: c.req.method,
      headers: {
        Accept: c.req.header("accept") || "*/*",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
    });
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
  responseHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
