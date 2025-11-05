// src/components/ui/label.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
  hint?: string;
};

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, hint, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "inline-block mb-2",
        "text-sm font-semibold leading-none",
        "text-foreground",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className
      )}
      {...props}
    >
      <span className="align-middle">{children}</span>
      {required ? (
        <span
          aria-hidden="true"
          className="ml-1 align-middle text-destructive"
          title="Required"
        >
          *
        </span>
      ) : null}
      {hint ? (
        <span className="ml-2 text-xs font-normal text-muted-foreground align-middle">
          {hint}
        </span>
      ) : null}
    </label>
  )
);

Label.displayName = "Label";
