// src/lib/utils.ts  (CLIENT-SAFE ONLY)
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-friendly className combiner */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Optional: cookie helper usable on both server/client */
export function readCookiesFromHeaders(headers: Headers): Map<string, string> {
  const out = new Map<string, string>();
  const raw = headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out.set(k, decodeURIComponent(rest.join("=")));
  }
  return out;
}

/** Format currency values */
export function formatCurrency(value: number | string, currency: string = 'USD'): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '-';
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(numValue);
}

/** Format date and time values */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '-';
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
}
