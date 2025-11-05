"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastVariant = "default" | "success" | "destructive";
export type ToastId = string;

export type ToastOptions = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms (default 3000)
  action?: { label: string; onClick: () => void };
};

export type Toast = ToastOptions & {
  id: ToastId;
  createdAt: number;
};

type ToastContextValue = {
  toasts: Toast[];
  add: (opts: ToastOptions) => ToastId;
  dismiss: (id?: ToastId) => void;
  remove: (id: ToastId) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<ToastId, number>>(new Map());

  const remove = useCallback((id: ToastId) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const dismiss = useCallback(
    (id?: ToastId) => {
      if (!id) return setToasts([]);
      remove(id);
    },
    [remove]
  );

  const add = useCallback(
    (opts: ToastOptions) => {
      const id = crypto.randomUUID();
      const toast: Toast = {
        id,
        createdAt: Date.now(),
        variant: opts.variant ?? "default",
        duration: opts.duration ?? 3000,
        title: opts.title,
        description: opts.description,
        action: opts.action,
      };
      setToasts((list) => [...list, toast]);

      const timer = window.setTimeout(() => remove(id), toast.duration);
      timers.current.set(id, timer);

      return id;
    },
    [remove]
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, add, dismiss, remove }),
    [toasts, add, dismiss, remove]
  );

  // ⬇️ no JSX here, safe for .ts
  return React.createElement(ToastContext.Provider, { value }, children);
}

// Hook
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast must be used within <ToastProvider>. Wrap your app in ToastProvider."
    );
  }
  return {
    toast: ctx.add,
    dismiss: ctx.dismiss,
    toasts: ctx.toasts,
  };
}
