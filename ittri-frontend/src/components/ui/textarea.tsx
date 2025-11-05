// src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

type TextareaSize = "sm" | "md" | "lg";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: TextareaSize;
  /** Convenience prop; sets aria-invalid and token border */
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size = "md", invalid, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const sizes: Record<TextareaSize, string> = {
      sm: "min-h-[72px] rounded-lg px-3 py-2 text-xs",
      md: "min-h-[88px] rounded-xl px-4 py-3 text-sm",
      lg: "min-h-[112px] rounded-2xl px-5 py-4 text-base",
    };

    return (
      <textarea
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
        className={cn(
          "w-full resize-y",
          // density
          sizes[size],
          // surface: glass + token border
          "glass",
          // colors from tokens
          "text-foreground placeholder:text-muted-foreground",
          // interaction + focus ring from tokens
          "transition-all duration-200 focus-visible:outline-none focus-neon",
          // disabled
          "disabled:cursor-not-allowed disabled:opacity-50",
          // invalid state via tokens
          "aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
