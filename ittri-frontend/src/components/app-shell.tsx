// src/components/layout/app-shell.tsx
'use client';

import * as React from 'react';

export default function AppShell({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-x-hidden custom-scrollbar bg-background text-foreground">
      {/* Background stack (token-based, follows globals.css) */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        {/* Soft radial ambience (uses .bg-gradient-radial from globals) */}
        <div className="absolute inset-0 bg-gradient-radial" />

        {/* Token orbs (use CSS vars so they adapt to light/dark) */}
        <div
          className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full blur-[120px] animate-float"
          style={{ background: 'rgba(var(--ring-rgb), .10)' }}
          aria-hidden
        />
        <div
          className="absolute bottom-0 right-1/4 h-[600px] w-[600px] rounded-full blur-[140px] animate-float-delayed"
          style={{ background: 'rgba(var(--foreground-rgb), .06)' }}
          aria-hidden
        />
        <div
          className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px] animate-pulse-slow"
          style={{ background: 'rgba(var(--ring-rgb), .06)' }}
          aria-hidden
        />

        {/* Animated starfield layers from globals.css */}
        <div className="stars absolute inset-0" aria-hidden />
        <div className="stars stars--sm absolute inset-0" aria-hidden />

        {/* Optional top aurora scanner (global class animates it) */}
        <div className="top-aurora" aria-hidden />
      </div>

      {/* Skip link for a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus-neon absolute left-4 top-4 z-50 rounded-xl px-4 py-2 text-sm font-semibold glass"
      >
        Skip to content
      </a>

      <main
        id="main-content"
        className={
          compact
            ? 'mx-auto flex min-h-screen max-w-md items-center justify-center p-6'
            : 'mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-6 md:px-8 md:py-8'
        }
      >
        {compact ? (
          // Compact layout (auth / modals / focused pages)
          <div className="card-futuristic w-full animate-fade-in p-6 sm:p-8">{children}</div>
        ) : (
          // Standard app pages
          <div className="w-full animate-fade-in">{children}</div>
        )}
      </main>
    </div>
  );
}
