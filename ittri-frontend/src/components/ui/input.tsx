// src/components/ui/input.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      // sizing
      "flex h-10 w-full rounded-xl px-4 py-2 text-sm",
      // surfaces & borders (tokens)
      "bg-input text-foreground placeholder:text-muted-foreground",
      "border border-border",
      // interactions
      "transition-colors duration-200",
      "focus-visible:outline-none focus-neon focus:border-ring",
      // states
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground",
      "aria-[invalid=true]:border-destructive",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
