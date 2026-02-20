import type { Context, MiddlewareHandler, Next } from "hono";

/**
 * Basic Authentication middleware for the bfloat sidecar.
 *
 * The Tauri backend generates a random shared secret at launch time and passes
 * it to both the sidecar (via --password CLI flag) and the renderer (via an
 * environment variable injected at build time or via IPC). The renderer then
 * sends every HTTP request with an Authorization header using HTTP Basic auth:
 *
 *   Authorization: Basic base64("bfloat:<password>")
 *
 * The username is always "bfloat". Only the password is meaningful — it is a
 * server-side secret that prevents other processes on the same machine from
 * talking to the sidecar.
 */
export function authMiddleware(password: string): MiddlewareHandler {
  if (!password) {
    throw new Error(
      "authMiddleware: password must be a non-empty string. " +
        "Pass --password <secret> when starting the sidecar."
    );
  }

  // Pre-compute the expected Authorization header value so we avoid doing
  // base64 encoding on every request.
  const expectedCredentials = Buffer.from(`bfloat:${password}`).toString("base64");
  const expectedHeader = `Basic ${expectedCredentials}`;

  return async function auth(c: Context, next: Next): Promise<Response | void> {
    const authHeader = c.req.header("Authorization");

    // The browser EventSource API (used for SSE streams like provider
    // connect-anthropic / connect-openai) cannot set custom request headers.
    // In that case the renderer passes the password as a query parameter
    // instead: ?password=<secret>.  Accept either mechanism.
    const queryPassword = new URL(c.req.url).searchParams.get("password");

    let authenticated = false;

    if (authHeader === expectedHeader) {
      authenticated = true;
    } else if (queryPassword && queryPassword === password) {
      authenticated = true;
    }

    if (!authenticated) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Invalid or missing credentials. Use HTTP Basic auth or ?password= query parameter.",
        },
        401,
        {
          "WWW-Authenticate": 'Basic realm="bfloat-sidecar"',
        }
      );
    }

    await next();
  };
}
