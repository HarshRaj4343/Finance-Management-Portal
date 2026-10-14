"use client";
import Image from "next/image";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { safeCallbackPath } from "@/lib/security";
import { homeFor } from "@/lib/roles";

/**
 * useSearchParams needs a Suspense boundary above it, so the form is a
 * separate component and the exported page wraps it.
 */
function LoginForm() {
  // Where to go after signing in. /bill/[id] sends people here when they
  // scan a QR code without a session, and they should land back on the
  // bill rather than on their own desk.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      redirect: false,
      username,
      password,
      callbackUrl: "/",
    });

    if (res?.error) {
      // NextAuth reports every failure the same way. Do not guess at the
      // cause -- a wrong password and an unreachable LDAP server look
      // identical from here.
      setError(
        res.error === "CredentialsSignin"
          ? "That username and password were not accepted."
          : res.error
      );
      setLoading(false);
      return;
    }

    if (res?.ok) {
      try {
        const session = await getSession();
        if (!session?.user?.id) {
          setError("Signed in, but the session could not be read. Please try again.");
          setLoading(false);
          return;
        }

        // The role comes from the database, resolved during sign-in.
        // homeFor understands the older spellings that are still in the
        // data, so nobody lands on a route that does not exist.
        // Only follow a same-origin path, so the parameter cannot be used
        // to bounce somebody to another site after they sign in.
        const safe = safeCallbackPath(callbackUrl);

        window.location.href = safe ?? homeFor(session.user.employee_type);
        return;
      } catch {
        setError(
          "Signed in, but could not work out where to send you. " +
            "If you are off campus, connect to the IIT Mandi network and try again."
        );
      }
    }

    setLoading(false);
  };

  const expired = searchParams.get("expired") === "1";
  const field = "w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:text-base";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#217093] p-4 sm:p-6">
      <div className="mx-auto w-full max-w-md rounded-xl bg-white p-6 shadow-lg sm:p-8">
        <div className="mb-6 flex flex-col items-center space-y-3 sm:mb-8">
          <Image width={80} height={80} src="/iit.png" alt="IIT Mandi" className="h-16 w-16 sm:h-20 sm:w-20" priority />
          <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Sign in</h1>
          <p className="text-center text-sm text-slate-600">Integrated Finance Management Portal</p>
        </div>

        {expired && (
          <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Your session ended after eight hours. Please sign in again.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" aria-describedby={error ? "login-error" : undefined}>
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">LDAP username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter your username"
              className={field}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">LDAP password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p id="login-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-70 sm:text-base"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                Signing in…
              </span>
            ) : (
              "Sign in"
            )}
          </button>

          <p className="mt-6 text-center text-xs text-slate-600 sm:text-sm">
            Use your institute LDAP credentials. No access? Contact the Dean&apos;s office.
          </p>
        </form>
      </div>
    </main>
  );
} //


export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#217093]">
          <p className="text-white/80 text-sm">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
