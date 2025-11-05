// src/components/navigation/nav-link.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Props = {
  to: string;
  /** Match the path exactly (default: startsWith) */
  exact?: boolean;
  className?: string;
  /** Extra classes when active (merged with defaults) */
  activeClassName?: string;
  /** Disable Next prefetch if needed */
  prefetch?: boolean;
  children: React.ReactNode;
};

function normalize(p: string) {
  // strip trailing slash except root
  return p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
}

export default function NavLink({
  to,
  exact = false,
  className,
  activeClassName,
  prefetch,
  children,
}: Props) {
  const pathname = usePathname() || '/';
  const here = normalize(pathname);
  const there = normalize(to);

  const isActive = exact ? here === there : (here === '/' ? there === '/' : here.startsWith(there));

  return (
    <Link
      href={to}
      prefetch={prefetch}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        // Base: muted -> foreground on hover, nice hit area, token focus
        'px-2 py-1 rounded-lg transition-colors',
        'text-muted-foreground hover:text-foreground focus-neon',
        // Active: promote to foreground + slight weight (token-friendly)
        isActive && 'text-foreground font-medium',
        // Optional extra active classes from caller
        isActive && activeClassName,
        className
      )}
    >
      {children}
    </Link>
  );
}
