// Centralized, typed routes for the app router

/* small internal helper */
const qs = (params: Record<string, any>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  const search = new URLSearchParams(entries as any).toString();
  return search ? `?${search}` : '';
};

export const routes = {
  home: () => '/' as const,

  auth: {
    // ⛔️ unchanged (your login works with these paths)
    login: () => '/login' as const,
    register: () => '/register' as const,
    logout: () => '/logout' as const,
  },

  // Dashboard page routes
  dashboard: {
    root: () => '/dashboard' as const,

    // Store management
    stores: {
      root: () => '/dashboard/stores' as const,
      create: () => '/dashboard/stores/create' as const,
      view: (storeId: string) => `/dashboard/stores/${storeId}` as const,
      edit: (storeId: string) => `/dashboard/stores/${storeId}/edit` as const,
      settings: (storeId: string) => `/dashboard/stores/${storeId}/settings` as const,
    },

    // Product management within stores
    products: {
      root: (storeId?: string) =>
        (storeId ? `/dashboard/stores/${storeId}/products` : '/dashboard/products') as const,
      create: (storeId: string) => `/dashboard/stores/${storeId}/products/create` as const,
      view: (storeId: string, productId: string) =>
        `/dashboard/stores/${storeId}/products/${productId}` as const,
      edit: (storeId: string, productId: string) =>
        `/dashboard/stores/${storeId}/products/${productId}/edit` as const,
      inventory: (storeId: string) => `/dashboard/stores/${storeId}/products/inventory` as const,
    },

    // Order management
    orders: {
      root: (storeId?: string) =>
        (storeId ? `/dashboard/stores/${storeId}/orders` : '/dashboard/orders') as const,
      view: (storeId: string, orderId: string) =>
        `/dashboard/stores/${storeId}/orders/${orderId}` as const,
      tracking: (storeId: string, orderId: string) =>
        `/dashboard/stores/${storeId}/orders/${orderId}/tracking` as const,
    },

    // AI Chat management
    conversations: {
      root: (storeId?: string) =>
        (storeId ? `/dashboard/stores/${storeId}/conversations` : '/dashboard/conversations') as const,
      view: (storeId: string, conversationId: string) =>
        `/dashboard/stores/${storeId}/conversations/${conversationId}` as const,
      chat: (storeId: string, conversationId: string) =>
        `/dashboard/stores/${storeId}/conversations/${conversationId}/chat` as const,
      analytics: (storeId: string) => `/dashboard/stores/${storeId}/conversations/analytics` as const,
    },

    // Analytics
    analytics: {
      root: () => '/dashboard/analytics' as const,
      store: (storeId: string) => `/dashboard/stores/${storeId}/analytics` as const,
      sales: (storeId: string) => `/dashboard/stores/${storeId}/analytics/sales` as const,
      customers: (storeId: string) => `/dashboard/stores/${storeId}/analytics/customers` as const,
    },

    // Settings
    settings: {
      root: () => '/dashboard/settings' as const,
      profile: () => '/dashboard/settings/profile' as const,
      billing: () => '/dashboard/settings/billing' as const,
      notifications: () => '/dashboard/settings/notifications' as const,
    },
  },

  // API routes (Next API proxies)
  api: {
    auth: {
      me: () => '/api/auth/me' as const,
      login: () => '/api/auth/login' as const,
      logout: () => '/api/auth/logout' as const,
    },

    // Standalone store CRUD proxies (used by Stores page)
    stores: {
      list: () => '/api/stores' as const,
      create: () => '/api/stores' as const,
      get: (storeId: string) => `/api/stores/${storeId}` as const,
      update: (storeId: string) => `/api/stores/${storeId}` as const,
      delete: (storeId: string) => `/api/stores/${storeId}` as const,
      metrics: (storeId: string) => `/api/stores/${storeId}/metrics` as const,
    },

    products: {
      list: (storeId: string) => `/api/stores/${storeId}/products` as const,
      create: (storeId: string) => `/api/stores/${storeId}/products` as const,
      get: (storeId: string, productId: string) =>
        `/api/stores/${storeId}/products/${productId}` as const,
      update: (storeId: string, productId: string) =>
        `/api/stores/${storeId}/products/${productId}` as const,
      delete: (storeId: string, productId: string) =>
        `/api/stores/${storeId}/products/${productId}` as const,
    },

    orders: {
      list: (storeId: string) => `/api/stores/${storeId}/orders` as const,
      get: (storeId: string, orderId: string) =>
        `/api/stores/${storeId}/orders/${orderId}` as const,
      update: (storeId: string, orderId: string) =>
        `/api/stores/${storeId}/orders/${orderId}` as const,
    },

    conversations: {
      list: (storeId: string) => `/api/stores/${storeId}/conversations` as const,
      get: (storeId: string, conversationId: string) =>
        `/api/stores/${storeId}/conversations/${conversationId}` as const,
      messages: (storeId: string, conversationId: string) =>
        `/api/stores/${storeId}/conversations/${conversationId}/messages` as const,
    },

    // 🔧 Dashboard proxies aligned to /api/dashboard/*
    dashboard: {
      metrics: (storeId?: string) =>
        (storeId
          ? `/api/dashboard/metrics${qs({ storeId })}`
          : '/api/dashboard/metrics') as const,

      orders: (opts?: {
        storeId?: string;
        limit?: number;
        page?: number;
        status?: string;
        from?: string; // ISO date
        to?: string;   // ISO date
      }) => (`/api/dashboard/orders${qs(opts || {})}`) as const,

      product: (opts?: {
        storeId?: string;
        limit?: number;
        page?: number;
        status?: string;
        q?: string;
      }) => (`/api/dashboard/product${qs(opts || {})}`) as const,

      // collection-level (your folder exists): supports optional storeId filter
      stores: (storeId?: string) =>
        (`/api/dashboard/stores${qs({ storeId })}`) as const,
    },
  },
};

// Navigation items for Sidebar (plain labels)
export const navigationItems = [
  { name: 'Dashboard',   icon: 'Home',         href: routes.dashboard.root(),            gradient: 'from-cyan-400 to-blue-500' },
  { name: 'Stores',      icon: 'Store',        href: routes.dashboard.stores.root(),     gradient: 'from-purple-400 to-pink-500' },
  { name: 'Products',    icon: 'Package',      href: routes.dashboard.products.root(),   gradient: 'from-green-400 to-cyan-500' },
  { name: 'Orders',      icon: 'ShoppingCart', href: routes.dashboard.orders.root(),     gradient: 'from-orange-400 to-red-500' },
  { name: 'Conversations', icon: 'MessageSquare', href: routes.dashboard.conversations.root(), gradient: 'from-indigo-400 to-purple-500' },
  { name: 'Analytics',   icon: 'BarChart3',    href: routes.dashboard.analytics.root(),  gradient: 'from-pink-400 to-rose-500' },
  { name: 'Settings',    icon: 'Settings',     href: routes.dashboard.settings.root(),   gradient: 'from-slate-400 to-slate-600' },
];

// Store-specific navigation (plain labels)
export const getStoreNavigation = (storeId: string) => [
  { name: 'Overview',      icon: 'Home',         href: routes.dashboard.stores.view(storeId),          gradient: 'from-cyan-400 to-blue-500' },
  { name: 'Products',      icon: 'Package',      href: routes.dashboard.products.root(storeId),        gradient: 'from-green-400 to-cyan-500' },
  { name: 'Orders',        icon: 'ShoppingCart', href: routes.dashboard.orders.root(storeId),          gradient: 'from-orange-400 to-red-500' },
  { name: 'Conversations', icon: 'MessageSquare', href: routes.dashboard.conversations.root(storeId),  gradient: 'from-indigo-400 to-purple-500' },
  { name: 'Analytics',     icon: 'BarChart3',    href: routes.dashboard.analytics.store(storeId),      gradient: 'from-pink-400 to-rose-500' },
  { name: 'Settings',      icon: 'Settings',     href: routes.dashboard.stores.settings(storeId),      gradient: 'from-slate-400 to-slate-600' },
];


// Helper functions
export const getCurrentPath = (pathname: string) => {
  if (pathname === '/dashboard') return 'dashboard';
  if (pathname.startsWith('/dashboard/stores')) return 'stores';
  if (pathname.startsWith('/dashboard/products')) return 'products';
  if (pathname.startsWith('/dashboard/orders')) return 'orders';
  if (pathname.startsWith('/dashboard/conversations')) return 'conversations';
  if (pathname.startsWith('/dashboard/analytics')) return 'analytics';
  if (pathname.startsWith('/dashboard/settings')) return 'settings';
  return 'dashboard';
};

export const getStoreIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/\/dashboard\/stores\/([^\/]+)/);
  return match ? match[1] : null;
};

export const isStorePage = (pathname: string): boolean =>
  pathname.includes('/dashboard/stores/') && pathname.split('/').length >= 4;
