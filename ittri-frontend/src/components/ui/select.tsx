// src/components/ui/select.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

type SelectSize = "default" | "sm" | "lg";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  size?: SelectSize;
  /** Shortcut for setting aria-invalid + token border */
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, size = "default", invalid, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const sizes: Record<SelectSize, string> = {
      sm: "h-9 rounded-lg px-3 pr-9 text-xs",
      default: "h-10 rounded-xl px-4 pr-10 text-sm",
      lg: "h-11 rounded-2xl px-5 pr-12 text-base",
    };

    return (
      <select
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
        className={cn(
          // Layout & density
          "flex w-full",
          sizes[size],
          // Surface (glass + token border, no hard colors)
          "glass",
          // Text colors from tokens
          "text-foreground placeholder:text-muted-foreground",
          // Interactions
          "transition-all duration-200",
          "focus-visible:outline-none focus-neon",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Replace native arrow with token-colored chevron (uses currentColor)
          "appearance-none",
          "bg-[url(\"data:image/svg+xml;utf8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")]",
          "bg-[length:1.125rem] bg-[right_0.625rem_center] bg-no-repeat",
          // Invalid state via tokens
          "aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";
