// src/components/ui/password-input.tsx
"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  /** Show an adaptive, token-based strength meter */
  strength?: boolean;
};

export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
  ({ className, label, hint, error, strength = false, id, ...props }, ref) => {
    const [show, setShow] = React.useState(false);
    const inputId = id || React.useId();
    const [value, setValue] = React.useState(props.defaultValue?.toString() ?? "");

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      props.onChange?.(e);
    };

    // Simple heuristic strength score (0..5)
    const score = React.useMemo(() => {
      if (!strength) return 0;
      let s = 0;
      if (value.length >= 8) s++;
      if (/[A-Z]/.test(value)) s++;
      if (/[a-z]/.test(value)) s++;
      if (/[0-9]/.test(value)) s++;
      if (/[^A-Za-z0-9]/.test(value)) s++;
      return s;
    }, [value, strength]);

    // width + token color
    const strengthWidth =
      score <= 1 ? "12%" : score === 2 ? "30%" : score === 3 ? "55%" : score === 4 ? "78%" : "96%";
    const strengthColor =
      score <= 2
        ? `rgba(var(--destructive-rgb), 1)` // weak
        : score === 3
        ? `rgba(var(--ring-rgb), .7)`       // medium
        : `rgba(var(--ring-rgb), 1)`;       // strong

    const srStrength =
      score <= 1 ? "Weak password" : score === 2 ? "Fair password" : score === 3 ? "Good password" : score >= 4 ? "Strong password" : "";

    const describedBy: string[] = [];
    if (hint) describedBy.push(`${inputId}-hint`);
    if (error) describedBy.push(`${inputId}-error`);

    return (
      <div className={cn("space-y-1", className)}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-semibold text-foreground">
            {label}
          </label>
        )}

        <div
          className={cn(
            "group relative flex items-center rounded-xl border bg-transparent glass",
            "focus-within:shadow-[var(--focus-ring)]",
            "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background",
            error && "border-destructive"
          )}
        >
          <input
            id={inputId}
            ref={ref}
            type={show ? "text" : "password"}
            autoComplete={props.autoComplete ?? "new-password"}
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy.join(" ") || undefined}
            className={cn(
              "peer w-full bg-transparent px-3 py-2 text-sm",
              "text-foreground placeholder:text-muted-foreground",
              "focus:outline-none"
            )}
            {...props}
            onChange={onChange}
          />

          <button
            type="button"
            title={show ? "Hide password" : "Show password"}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
            className={cn(
              "absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-neon"
            )}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {strength && (
          <>
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
              <div className="h-full transition-all" style={{ width: strengthWidth, background: strengthColor }} />
            </div>
            <p className="sr-only" aria-live="polite">{srStrength}</p>
          </>
        )}

        {hint && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="text-xs" style={{ color: `rgba(var(--destructive-rgb), 1)` }}>
            {error}
          </p>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";
