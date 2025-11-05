// src/components/ui/badge.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Small leading dot that inherits the badge color */
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", size = "md", dot = false, ...props }, ref) => {
    // Map variants to existing design tokens (no new colors introduced).
    // - default/info/success/warning use --ring-rgb (brand-accent family)
    // - secondary uses --muted-foreground-rgb
    // - destructive uses --destructive-rgb
    // - outline is neutral on --border-rgb/foreground
    const variantToRGB: Record<BadgeVariant, string> = {
      default: "var(--ring-rgb)",
      info: "var(--ring-rgb)",
      success: "var(--ring-rgb)",
      warning: "var(--ring-rgb)",
      secondary: "var(--muted-foreground-rgb)",
      destructive: "var(--destructive-rgb)",
      outline: "var(--foreground-rgb)", // only used for text on outline
    };

    const sizes: Record<BadgeSize, string> = {
      sm: "text-[10px] px-2 py-0.5",
      md: "text-xs px-2.5 py-0.5",
      lg: "text-sm px-3 py-1",
    };

    const isOutline = variant === "outline";

    // Inline CSS var to drive the arbitrary Tailwind color utilities below
    const styleVar =
      { ["--badge-rgb" as any]: variantToRGB[variant] } as React.CSSProperties;

    return (
      <div
        ref={ref}
        style={styleVar}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border font-bold uppercase tracking-wider",
          "backdrop-blur-sm transition-all duration-200",
          sizes[size],
          // Filled styles (from tokens)
          !isOutline &&
            "bg-[rgba(var(--badge-rgb),.12)] text-[rgba(var(--badge-rgb),.95)] border-[rgba(var(--badge-rgb),.35)] shadow-[0_0_14px_rgba(var(--badge-rgb),.18)] hover:bg-[rgba(var(--badge-rgb),.16)] hover:brightness-110",
          // Outline (neutral)
          isOutline &&
            "bg-transparent text-foreground border-[rgba(var(--border-rgb),1)] hover:bg-[rgba(var(--foreground-rgb),.06)]",
          "focus:outline-none focus-neon",
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              "mr-0.5 inline-block h-1.5 w-1.5 rounded-full",
              isOutline
                ? "bg-foreground"
                : "bg-[rgba(var(--badge-rgb),.95)]"
            )}
          />
        )}
        <span className="truncate">{props.children}</span>
      </div>
    );
  }
);

Badge.displayName = "Badge";
