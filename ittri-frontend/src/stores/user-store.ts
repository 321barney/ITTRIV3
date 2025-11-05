'use client'

import { create } from 'zustand'
import type { User, Store } from '@/types'

interface UserStore {
  user: User | null;
  stores: Store[];
  currentStore: Store | null;
  setUser: (user: User) => void;
  setStores: (stores: Store[]) => void;
  setCurrentStore: (store: Store) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  stores: [],
  currentStore: null,
  setUser: (user) => set({ user }),
  setStores: (stores) => set({ stores }),
  setCurrentStore: (store) => set({ currentStore: store }),
  clearUser: () => set({ user: null, stores: [], currentStore: null }),
}))

export const useCurrentStore = () => useUserStore((s) => s.currentStore)
export const useUser = () => useUserStore((s) => s.user)
