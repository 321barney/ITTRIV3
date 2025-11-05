// src/components/ui/switch.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type SwitchSize = "sm" | "md" | "lg";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  id?: string;
  name?: string;
  size?: SwitchSize;
  /** Optional accessible label (visually hidden if you don’t render your own) */
  "aria-label"?: string;
}

export function Switch({
  checked: controlled,
  defaultChecked,
  disabled,
  onCheckedChange,
  className,
  id,
  name,
  size = "md",
  ...rest
}: SwitchProps) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultChecked);
  const isControlled = controlled !== undefined;
  const checked = isControlled ? controlled! : uncontrolled;

  const sizes: Record<SwitchSize, { track: string; knobOn: string; knobOff: string }> = {
    sm: {
      track: "h-5 w-9",
      knobOn: "translate-x-4",
      knobOff: "translate-x-0.5",
    },
    md: {
      track: "h-6 w-11",
      knobOn: "translate-x-5",
      knobOff: "translate-x-1",
    },
    lg: {
      track: "h-7 w-14",
      knobOn: "translate-x-7",
      knobOff: "translate-x-1.5",
    },
  };

  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setUncontrolled((v) => !v);
    onCheckedChange?.(!checked);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      id={id}
      name={name}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex items-center rounded-full transition-all",
        "border border-border focus-neon",
        // glassy track that adapts to theme tokens
        "backdrop-blur-xl",
        sizes[size].track,
        checked
          // ON: use ring token for a subtle neon-ish track
          ? "bg-[rgba(var(--ring-rgb),0.85)] shadow-[0_0_0_3px_rgba(var(--ring-rgb),.15)_inset]"
          // OFF: soft token surface
          : "bg-white/10",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      {...rest}
    >
      {/* subtle highlight on the track */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full",
          "bg-[radial-gradient(120%_60%_at_0%_0%,rgba(255,255,255,.12),transparent)]"
        )}
      />

      {/* knob */}
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-block rounded-full shadow",
          "h-5 w-5",
          "bg-background border border-border",
          "transition-transform will-change-transform",
          checked ? sizes[size].knobOn : sizes[size].knobOff
        )}
        style={{
          // tiny outer glow when on (using ring token)
          boxShadow: checked
            ? "0 0 0 3px rgba(var(--ring-rgb), .20)"
            : "0 1px 1px rgba(0,0,0,.25)",
        }}
      />
    </button>
  );
}
