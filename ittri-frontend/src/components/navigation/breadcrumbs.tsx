// src/components/navigation/breadcrumbs.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

function prettify(seg: string) {
  // strip bracketed dynamic segments like [id]
  const clean = seg.replace(/^\[|\]$/g, '');
  const dec = decodeURIComponent(clean).replace(/[-_]+/g, ' ').trim();
  if (!dec) return '…';
  return dec.charAt(0).toUpperCase() + dec.slice(1);
}

function shortIdLabel(seg: string) {
  // if it looks like an id/uuid, show short hash
  const s = seg.toLowerCase();
  const looksId =
    s.length > 12 &&
    (/^[a-f0-9-]{12,}$/.test(s) || /^[a-z0-9]{12,}$/.test(s));
  if (!looksId) return null;
  // simple short display; full value in title
  return `#${s.replace(/-/g, '').slice(0, 6)}…`;
}

export default function Breadcrumbs({
  className,
}: {
  className?: string;
}) {
  const pathname = usePathname() || '/';

  // Remove trailing slash except root, strip query/hash if present (shouldn't in pathname but safe)
  const cleanPath = pathname.split(/[?#]/)[0].replace(/\/+(?=\/|$)/g, '/');
  const parts = cleanPath.split('/').filter(Boolean);

  if (parts.length === 0) return null;

  // Build segments
  const segs = parts.map((seg, i) => {
    const href = '/' + parts.slice(0, i + 1).join('/');
    const label = prettify(seg);
    const idShort = shortIdLabel(seg);
    return { href, label, raw: seg, idShort };
  });

  const Separator = () => (
    <span
      aria-hidden="true"
      className="mx-1 inline-flex h-4 items-center text-muted-foreground/80"
    >
      {/* chevron that inherits currentColor */}
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="opacity-70">
        <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        // keep it subtle and on-brand
        'px-4 py-2 text-sm text-muted-foreground',
        className
      )}
    >
      <ol className="flex items-center flex-wrap">
        <li className="inline-flex items-center">
          <Link
            href={routes.home()}
            className={cn(
              'rounded-lg px-1 transition-colors focus-neon',
              'hover:text-foreground'
            )}
          >
            Home
          </Link>
        </li>

        {segs.map((seg, idx) => {
          const last = idx === segs.length - 1;
          const label = seg.idShort ?? seg.label;

          return (
            <li key={seg.href} className="inline-flex items-center">
              <Separator />
              {last ? (
                <span
                  aria-current="page"
                  title={seg.idShort ? seg.label : undefined}
                  className="px-1 text-foreground"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={seg.href}
                  title={seg.idShort ? seg.label : undefined}
                  className={cn(
                    'rounded-lg px-1 transition-colors focus-neon',
                    'hover:text-foreground'
                  )}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
