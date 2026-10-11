import "./globals.css";
import type { Metadata } from "next";
import NextAuthProvider from "../providers/SessionProvider"; // wrap session

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
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <NextAuthProvider>
          {children}
        </NextAuthProvider>
      </body>
    </html>
  );
}
