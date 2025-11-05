// src/app/(auth)/layout.tsx
import AppShell from '@/components/app-shell'

export const metadata = {
  title: 'ITTRI - Neural Authentication',
  description: 'Secure access to quantum systems',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AppShell compact>{children}</AppShell>
}
