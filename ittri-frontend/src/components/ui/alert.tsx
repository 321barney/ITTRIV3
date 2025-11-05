// src/components/ui/alert.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type AlertVariant =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "destructive";

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  /** Optional leading icon */
  icon?: React.ReactNode;
  /** Show a close button and call when dismissed */
  onClose?: () => void;
  /** Live region politeness (defaults to 'polite') */
  politeness?: "polite" | "assertive" | "off";
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      children,
      icon,
      variant = "default",
      onClose,
      politeness = "polite",
      ...props
    },
    ref
  ) => {
    const base =
      "rounded-xl p-4 flex gap-3 items-start border glass";
    const palette: Record<AlertVariant, string> = {
      default: "",
      info:
        "border-blue-400/30 text-blue-300 bg-blue-500/10",
      success:
        "border-green-400/30 text-green-300 bg-green-500/10",
      warning:
        "border-amber-400/30 text-amber-300 bg-amber-500/10",
      destructive:
        "border-red-400/35 text-red-300 bg-red-500/10",
    };

    const role = variant === "destructive" ? "alert" : "status";
    const ariaLive =
      politeness === "off" ? "off" : politeness;

    return (
      <div
        ref={ref}
        role={role}
        aria-live={ariaLive}
        className={cn(base, palette[variant], className)}
        {...props}
      >
        {icon ? (
          <div className="mt-0.5 shrink-0">{icon}</div>
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className={cn(
              "ml-2 shrink-0 rounded-md p-1",
              "hover:bg-white/10 focus-visible:outline-none focus-neon"
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              className="opacity-80"
            >
              <path
                d="M14.348 5.652a.75.75 0 0 0-1.06-1.06L10 7.88 6.712 4.592a.75.75 0 1 0-1.06 1.06L8.94 8.94l-3.288 3.288a.75.75 0 1 0 1.06 1.06L10 10l3.288 3.288a.75.75 0 1 0 1.06-1.06L11.06 8.94l3.288-3.288Z"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : null}
      </div>
    );
  }
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mb-1 font-semibold text-foreground tracking-tight",
      className
    )}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "text-sm text-muted-foreground leading-6",
      className
    )}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";
