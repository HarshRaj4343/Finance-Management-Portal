import "./globals.css";
import type { Metadata } from "next";
import NextAuthProvider from "../providers/SessionProvider"; // wrap session
import { ConfirmProvider } from "@/components/ConfirmProvider";
import SessionExpiryWarning from "@/components/SessionExpiryWarning";

export const metadata: Metadata = {
  title: "IIT Mandi Finance Portal",
  description: "Integrated Finance Management Portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <NextAuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <SessionExpiryWarning />
        </NextAuthProvider>
      </body>
    </html>
  );
}
