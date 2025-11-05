// src/hooks/use-app-router.ts
'use client';

import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

export function useAppRouter() {
  const router = useRouter();

  const safeBack = (fallback: string = routes.home()) => {
    try {
      if (typeof window !== 'undefined') {
        // In App Router, history.length can be 1 even when we can go back;
        // try back(), then fall back after a short tick if we didn't navigate.
        const before = window.location.href;
        router.back();
        setTimeout(() => {
          if (window.location.href === before) router.push(fallback);
        }, 50);
        return;
      }
    } catch {}
    router.push(fallback);
  };

  const safeForward = () => {
    try {
      router.forward();
    } catch {}
  };

  return {
    routes,

    go: {
      to: (path: string) => router.push(path),
      home: () => router.push(routes.home()),
      login: () => router.push(routes.auth.login()),
      register: () => router.push(routes.auth.register()),
      dashboard: () => router.push(routes.dashboard.root()),

      // top-level (unscoped) sections
      stores: () => router.push(routes.dashboard.stores.root()),
      products: () => router.push(routes.dashboard.products.root()),
      orders: () => router.push(routes.dashboard.orders.root()),
      conversations: () => router.push(routes.dashboard.conversations.root()),
      analytics: () => router.push(routes.dashboard.analytics.root()),
      settings: () => router.push(routes.dashboard.settings.root()),

      // store-scoped navigations (pass a storeId)
      storeOverview: (storeId: string) =>
        router.push(routes.dashboard.stores.view(storeId)),
      storeProducts: (storeId: string) =>
        router.push(routes.dashboard.products.root(storeId)),
      storeOrders: (storeId: string) =>
        router.push(routes.dashboard.orders.root(storeId)),
      storeConversations: (storeId: string) =>
        router.push(routes.dashboard.conversations.root(storeId)),
      storeAnalytics: (storeId: string) =>
        router.push(routes.dashboard.analytics.store(storeId)),
      storeSettings: (storeId: string) =>
        router.push(routes.dashboard.stores.settings(storeId)),
    },

    replace: {
      to: (path: string) => router.replace(path),
      login: () => router.replace(routes.auth.login()),
      register: () => router.replace(routes.auth.register()),
      dashboard: () => router.replace(routes.dashboard.root()),
    },

    history: {
      back: safeBack,
      forward: safeForward,
    },

    refresh: () => router.refresh(),

    prefetch: (path: string) => {
      // avoid unhandled promise rejection in dev
      try {
        router.prefetch(path);
      } catch {}
    },
  };
}
