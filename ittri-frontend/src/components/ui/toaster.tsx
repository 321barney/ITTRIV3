"use client";

import React from "react";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";
import clsx from "clsx";

/**
 * Renders toasts. Place once near the root (e.g., in app/layout.tsx).
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-0 z-50 flex flex-col items-end gap-2 p-4 sm:p-6"
    >
      {/* top-right stack */}
      <div className="flex w-full flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto w-full max-w-sm rounded-xl border p-4 shadow-lg backdrop-blur-md transition-all",
              "bg-[rgba(var(--bg-canvas,17,17,19),0.9)] border-[rgba(var(--border-rgb,255,255,255),0.12)]",
              {
                "border-green-500/30": t.variant === "success",
                "border-red-500/40": t.variant === "destructive",
              }
            )}
            role="status"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                {t.title && (
                  <div className="text-sm font-semibold">
                    {t.title}
                  </div>
                )}
                {t.description && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t.description}
                  </div>
                )}
                {t.action && (
                  <button
                    onClick={() => t.action?.onClick()}
                    className="mt-3 inline-flex select-none items-center rounded-md border px-2 py-1 text-xs hover:opacity-90"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border hover:opacity-80"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
