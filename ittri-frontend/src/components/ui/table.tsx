// src/components/ui/table.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

/** Props shared by header/body/row helpers */
type Density = "comfortable" | "compact";

export function Table({
  className,
  stickyHeader = false,
  zebra = false,
  density = "comfortable",
  ...props
}: React.HTMLAttributes<HTMLTableElement> & {
  /** Keep the header visible while scrolling the table container */
  stickyHeader?: boolean;
  /** Alternate row background for readability */
  zebra?: boolean;
  /** Row density */
  density?: Density;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-auto rounded-xl border border-border",
        "bg-transparent backdrop-blur-sm", // subtle glass vibe without overdoing it
        "custom-scrollbar"
      )}
    >
      <table
        className={cn(
          "w-full caption-bottom text-sm",
          density === "compact" ? "text-[13px]" : "text-sm",
          className
        )}
        data-sticky={stickyHeader ? "true" : undefined}
        data-zebra={zebra ? "true" : undefined}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // muted header surface using tokens
        "bg-muted/30 text-left",
        // sticky behavior if parent opted in
        "data-[sticky=true]:sticky data-[sticky=true]:top-0 data-[sticky=true]:z-10",
        // soft border below header
        "border-b border-border",
        className
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("", className)} {...props} />;
}

export function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        "bg-muted/30",
        "border-t border-border",
        className
      )}
      {...props}
    />
  );
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        // default row border + hover
        "border-t border-border transition-colors",
        "hover:bg-foreground/5",
        // zebra striping if parent opted in
        "even:data-[zebra=true]:bg-foreground/[0.03]",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  scope = "col",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        // spacing scaled by density via parent
        "px-3 py-2",
        // uppercase, small, muted
        "text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
        // align start by default
        "text-left",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "px-3 py-2",
        "align-middle",
        className
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn(
        "mt-2 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
