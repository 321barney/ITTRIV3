// src/app/(auth)/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ITTRI - Authentication',
  description: 'Sign in / Sign up',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Pass-through layout so auth routes use the same global shell/theme
  return <>{children}</>
}
