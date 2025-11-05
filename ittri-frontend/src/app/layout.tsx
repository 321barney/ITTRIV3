// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AbortShieldProvider } from "@/providers/abort-shield-provider";
import DomRemoveChildGuard from "@/components/patches/DomRemoveChildGuard";
import DevDomDiagnostics from "@/components/patches/DevDomDiagnostics";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ITTRI Platform",
  description: "Modern SaaS platform for e-commerce automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const htmlProps =
    process.env.NODE_ENV !== "production" ? ({ "data-kantu": "" } as const) : ({} as const);

  return (
    <html lang="en" suppressHydrationWarning {...htmlProps}>
      <body className={`${inter.className} landing-force-dark text-foreground bg-transparent`}>
        {/* One-time background layers from globals.css */}
        <div className="space-backdrop" aria-hidden>
          <div className="stars" />
          <div className="stars stars--sm" />
        </div>
        <div className="top-aurora" aria-hidden />

        {/* Skip link (a11y) */}
        <a href="#app-content" className="sr-only focus:not-sr-only focus-neon absolute left-4 top-4 z-[999] rounded-xl px-4 py-2">
          Skip to content
        </a>

        <AbortShieldProvider>
          <QueryProvider>
            <ThemeProvider>
              <div id="app-content" className="relative min-h-screen custom-scrollbar">
                <DomRemoveChildGuard />
                <DevDomDiagnostics />
                {children}
              </div>
            </ThemeProvider>
          </QueryProvider>
        </AbortShieldProvider>
      </body>
    </html>
  );
}
