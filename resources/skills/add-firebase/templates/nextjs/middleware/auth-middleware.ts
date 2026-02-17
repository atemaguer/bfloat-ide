import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth } from "@/lib/firebase-admin";

const SESSION_COOKIE_NAME = "__session";

interface SessionUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

/**
 * Verify the session cookie and return user data
 * Returns null if not authenticated
 *
 * @example
 * // In a Server Component or Route Handler
 * const user = await verifySession();
 * if (!user) {
 *   redirect("/login");
 * }
 */
export async function verifySession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return null;
    }

    const auth = getAdminAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);

    return {
      uid: decodedClaims.uid,
      email: decodedClaims.email,
      emailVerified: decodedClaims.email_verified,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Require authentication - redirects to login if not authenticated
 * Use in Server Components to protect pages
 *
 * @param redirectTo - Path to redirect to if not authenticated (default: "/login")
 * @returns The authenticated user
 *
 * @example
 * // In a protected page Server Component
 * export default async function DashboardPage() {
 *   const user = await requireAuth();
 *   // user is guaranteed to exist here
 *   return <Dashboard userId={user.uid} />;
 * }
 */
export async function requireAuth(redirectTo = "/login"): Promise<SessionUser> {
  const user = await verifySession();

  if (!user) {
    redirect(redirectTo);
  }

  return user;
}

/**
 * Get the current user ID from session (for API routes)
 * Returns null if not authenticated
 *
 * @example
 * // In an API Route Handler
 * export async function GET() {
 *   const userId = await getCurrentUserId();
 *   if (!userId) {
 *     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   }
 *   // Fetch user-specific data
 * }
 */
export async function getCurrentUserId(): Promise<string | null> {
  const user = await verifySession();
  return user?.uid ?? null;
}
