import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Display face. Fraunces stands in for the brand's Kozuka Mincho Pro; only
// SemiBold and Black are used, so only those two weights are downloaded.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600", "900"],
});

// Interface face: forms, buttons, dates, tables and body text.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Studio Rags — textile art workshops in Adelaide",
    template: "%s · Studio Rags",
  },
  description:
    "Textile art workshops in Adelaide with Rehana Usman: Indonesian batik, Japanese shibori and Pakistani woodblock printing.",
};

// Anything but the real production site shows the banner, so nobody mistakes
// staging (or a preview) for the place to make a real booking.
const isTestSite = process.env.SITE_ENV !== "production";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-AU"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-purple px-5 py-3 font-semibold text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
        >
          Skip to main content
        </a>
        {isTestSite && (
          <aside
            aria-label="Test site notice"
            className="bg-purple px-4 py-2 text-center font-semibold text-white"
          >
            <p>Test site — bookings here are not real</p>
          </aside>
        )}
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
