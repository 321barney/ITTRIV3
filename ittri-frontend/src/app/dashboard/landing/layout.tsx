import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "@/app/globals.css";

// ⬇️ add these
import { ToastProvider } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Landing Studio • ITTRI",
  description: "Generate, edit, and preview landing pages with AI.",
};

export default function StudioSubtreeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {/* ⬇️ wrap your app once */}
          <ToastProvider>
            {children}
            {/* ⬇️ render the visual layer once */}
            <Toaster />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
