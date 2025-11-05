# Studio Client/Server Split & Route Fix

## Changes Applied to Studio

- Created `src/app/dashboard/landing/studio/StudioClient.tsx` with your original page code.
- Rewrote `src/app/dashboard/landing/studio/page.tsx` as a Server wrapper that renders the client component.

## Route Fixes
- Replaced any occurrences of `/dashboard/landing/landing/studio` with `/dashboard/landing/studio` across the codebase.

## Audit: Pages using React hooks but missing `'use client'`
- Found: `src/app/page.tsx` uses hooks and already includes `'use client'` at the top (OK).

## How to use
1. Replace your project's `src` directory with the one in this archive.
2. Run your dev server and verify `/dashboard/landing/studio` works without the hook error.
3. If you later add hooks to any other `page.tsx`, either add `'use client'` or split it like Studio.

## Server Wrapper Example
```tsx
import Studio from "./StudioClient";
export default function LandingStudioPage() {
  return <Studio />;
}
```