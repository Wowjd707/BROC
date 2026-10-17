import type { Metadata } from "next";
// Self-hosted from the `geist` package rather than next/font/google: the
// Google variant downloads the font at BUILD time, so a build with no route to
// fonts.googleapis.com — an air-gapped install, a locked-down CI runner —
// failed outright. Same typeface, same CSS variables.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { BRANDING } from "@/lib/branding";

export const metadata: Metadata = {
  title: BRANDING.productName,
  description: 'Track emissions, EHS KPIs, goals, and supplier sustainability data.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
