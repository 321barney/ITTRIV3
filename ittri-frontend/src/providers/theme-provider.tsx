"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme provider.
 * - Adds `class="light|dark"` on <html> (works great with Tailwind + your tokens)
 * - Defaults to dark to match your global CSS
 * - Honors system preference
 * - Avoids transition flicker on toggle
 * - Persists choice under `ittri-theme`
 */
export type AppThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...props }: AppThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="ittri-theme"
      themes={["light", "dark"]}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
