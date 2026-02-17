import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

// Session cookie name
const SESSION_COOKIE_NAME = "__session";

// Session expires in 5 days (longer than Firebase token lifetime)
const SESSION_EXPIRES_IN = 60 * 60 * 24 * 5 * 1000;

/**
 * POST /api/auth/session
 * Creates a session cookie from Firebase ID token
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const auth = getAdminAuth();

    // Verify the ID token
    const decodedToken = await auth.verifyIdToken(token);

    // Only allow tokens that were recently issued (within 5 minutes)
    const issuedAt = decodedToken.iat * 1000;
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    if (issuedAt < fiveMinutesAgo) {
      return NextResponse.json(
        { error: "Token too old. Please sign in again." },
        { status: 401 }
      );
    }

    // Create session cookie
    const sessionCookie = await auth.createSessionCookie(token, {
      expiresIn: SESSION_EXPIRES_IN,
    });

    // Set the cookie
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
      maxAge: SESSION_EXPIRES_IN / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 401 }
    );
  }
}

/**
 * DELETE /api/auth/session
 * Clears the session cookie
 */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);

  return NextResponse.json({ success: true });
}

/**
 * GET /api/auth/session
 * Returns current session status
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false });
    }

    const auth = getAdminAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);

    return NextResponse.json({
      authenticated: true,
      uid: decodedClaims.uid,
      email: decodedClaims.email,
    });
  } catch (error) {
    return NextResponse.json({ authenticated: false });
  }
}
