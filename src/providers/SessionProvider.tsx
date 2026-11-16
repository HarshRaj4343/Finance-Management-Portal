"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { withBase } from "@/lib/base-path";

/** NextAuth's routes live under the portal's base path, e.g. /finance/api/auth. */
export default function NextAuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider basePath={withBase("/api/auth")}>{children}</SessionProvider>;
}
