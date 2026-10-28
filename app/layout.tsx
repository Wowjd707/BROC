import type { Metadata } from "next";
// Fonts are self-hosted npm packages rather than next/font/google: the Google
// variant downloads the font at BUILD time, so a build with no route to
// fonts.googleapis.com — an air-gapped install, a locked-down CI runner —
// failed outright.
//
// Inter for the interface: designed for screens, legible at the small sizes a
// data-dense app lives at, with tabular figures so numbers line up in tables.
// Variable, with an optical-size axis, so one file covers every weight and
// headings tighten up on their own. SIL Open Font License.
import "@fontsource-variable/inter/opsz.css";
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
      className={`${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
