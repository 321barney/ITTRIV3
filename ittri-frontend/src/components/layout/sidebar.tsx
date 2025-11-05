// src/components/navigation/sidebar.tsx
'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { routes } from '@/lib/routes';
import { useUserStore, useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Home,
  Store as StoreIcon,
  Package,
  ShoppingCart,
  MessageSquare,
  BarChart3,
  Settings,
  Menu,
  ChevronDown,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  name: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  href: string;
  match?: 'startsWith' | 'exact';
};

type SidebarProps = HTMLAttributes<HTMLDivElement>;

export default function Sidebar(props: SidebarProps) {
  const pathname = usePathname() || '';
  const { stores = [], currentStore, setCurrentStore } = useUserStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setStoreDropdownOpen(false), [pathname]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!storeDropdownOpen) return;
      const t = e.target as Node;
      if (dropdownRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setStoreDropdownOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setStoreDropdownOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [storeDropdownOpen]);

  const navigation: NavItem[] = useMemo(
    () => [
      { name: 'Neural Center', icon: Home, href: routes.dashboard.root(), match: 'exact' },
      { name: 'Stores', icon: StoreIcon, href: routes.dashboard.stores.root(), match: 'startsWith' },
      { name: 'Products', icon: Package, href: routes.dashboard.products.root(), match: 'startsWith' },
      { name: 'Orders', icon: ShoppingCart, href: routes.dashboard.orders.root(), match: 'startsWith' },
      { name: 'Conversations', icon: MessageSquare, href: routes.dashboard.conversations.root(), match: 'startsWith' },
      { name: 'Analytics', icon: BarChart3, href: routes.dashboard.analytics.root(), match: 'startsWith' },
      { name: 'Settings', icon: Settings, href: routes.dashboard.settings.root(), match: 'startsWith' },
    ],
    []
  );

  const isActive = (item: NavItem) =>
    item.match === 'exact' ? pathname === item.href : pathname.startsWith(item.href);

  function onDropdownKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!storeDropdownOpen) return;
    const items = dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[data-store-item]');
    if (!items || items.length === 0) return;
    const idx = Array.from(items).findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <aside
      {...props}
      className={cn(
        'glass transition-all duration-300 h-full relative min-w-[5rem]',
        // token border
        'border-r',
        sidebarCollapsed ? 'w-20' : 'w-72',
        props.className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg glass grid place-items-center">
              <Zap className="h-4 w-4 text-foreground" />
            </div>
            <h1 className="text-xl font-black gradient-text-triple">ITTRI</h1>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="focus-neon"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={sidebarCollapsed}
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content area */}
      <div className="h-[calc(100%-7.5rem)] overflow-y-auto pb-40">
        {/* Store Selector */}
        {!sidebarCollapsed && (
          <div className="p-6 border-b">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active store
              </label>

              {currentStore ? (
                <div>
                  <Button
                    ref={buttonRef}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => setStoreDropdownOpen((v) => !v)}
                    aria-expanded={storeDropdownOpen}
                    aria-haspopup="listbox"
                    aria-controls="store-listbox"
                  >
                    <span className="truncate">{currentStore.name}</span>
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', storeDropdownOpen && 'rotate-180')}
                    />
                  </Button>

                  {storeDropdownOpen && (
                    <div
                      id="store-listbox"
                      ref={dropdownRef}
                      className="mt-2 glass rounded-lg p-2 focus-neon"
                      role="listbox"
                      tabIndex={-1}
                      onKeyDown={onDropdownKeyDown}
                    >
                      {stores.length > 0 ? (
                        stores.map((store) => (
                          <Button
                            key={store.id}
                            variant="ghost"
                            className="w-full justify-start text-sm"
                            onClick={() => {
                              setCurrentStore(store);
                              setStoreDropdownOpen(false);
                              buttonRef.current?.focus();
                            }}
                            role="option"
                            aria-selected={currentStore?.id === store.id}
                            data-store-item
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="truncate">{store.name}</span>
                              <Badge
                                variant={store.status === 'active' ? 'success' : 'secondary'}
                              >
                                {store.status}
                              </Badge>
                            </div>
                          </Button>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground px-2 py-1">No stores found</div>
                      )}
                      <Link
                        href={routes.dashboard.stores.root()}
                        onClick={() => setStoreDropdownOpen(false)}
                        className="block px-2 py-1 text-xs hover:text-foreground text-muted-foreground focus-neon rounded"
                      >
                        Manage stores
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <Link href={routes.dashboard.stores.root()}>
                  <Button variant="outline" className="w-full">
                    Select / Create a Store
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="p-6 space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link key={item.name} href={item.href} prefetch>
                <div
                  className={cn(
                    'group flex items-center gap-3 p-3 rounded-xl transition-all duration-300 cursor-pointer focus-neon',
                    sidebarCollapsed ? 'justify-center' : '',
                    active
                      ? 'bg-foreground/5 border border-border'
                      : 'hover:bg-foreground/5'
                  )}
                  aria-current={active ? 'page' : undefined}
                  title={sidebarCollapsed ? item.name : undefined}
                >
                  <div className="w-10 h-10 rounded-lg glass grid place-items-center group-hover:scale-105 transition-transform">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  {!sidebarCollapsed && (
                    <div className="flex-1 min-w-0">
                      <span
                        className={cn(
                          'block truncate font-medium transition-colors',
                          active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      >
                        {item.name}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* System Status (expanded) */}
      {!sidebarCollapsed && (
        <div className="absolute bottom-6 left-6 right-6">
          <div className="glass rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              System status
            </div>
            <StatusRow label="Neural networks" state="Online" />
            <StatusRow label="Core services" state="Active" />
            <StatusRow label="AI processes" state="Idle" />
          </div>
        </div>
      )}

      {/* System Status (collapsed) */}
      {sidebarCollapsed && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 transform">
          <div className="flex flex-col gap-1">
            <Dot />
            <Dot />
            <Dot />
          </div>
        </div>
      )}
    </aside>
  );
}

/* ---------- helpers (token-only) ---------- */

function StatusRow({ label, state }: { label: string; state: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground">{state}</span>
    </div>
  );
}

function Dot() {
  return <div className="w-2 h-2 rounded-full bg-foreground/50 animate-pulse" />;
}
