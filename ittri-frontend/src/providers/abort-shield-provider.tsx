// src/providers/abort-shield-provider.tsx
"use client";

import { PropsWithChildren, useEffect, useRef } from "react";
import { isAbortLike } from "@/lib/abort-utils";
import { usePathname } from "next/navigation";

export function AbortShieldProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const currentController = useRef<AbortController | null>(null);
  const patchedRef = useRef(false);

  // 1) Swallow unhandled aborts BEFORE other listeners (capture phase)
  useEffect(() => {
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = (e as any)?.reason ?? e;
      if (isAbortLike(reason)) {
        e.preventDefault();
        // stop other frameworks (Eruda/Devtools/Extensions) from logging it
        // @ts-ignore
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        return false;
      }
    };

    const onError = (e: ErrorEvent) => {
      if (isAbortLike(e.error)) {
        e.preventDefault();
        // @ts-ignore
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        return false;
      }
    };

    window.addEventListener("unhandledrejection", onUnhandled, { capture: true });
    window.addEventListener("error", onError, { capture: true });
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled, { capture: true } as any);
      window.removeEventListener("error", onError, { capture: true } as any);
    };
  }, []);

  // 2) Route-scoped controller (same as before)
  useEffect(() => {
    if (currentController.current && !currentController.current.signal.aborted) {
      try { currentController.current.abort("unmount"); } catch {}
    }
    currentController.current = new AbortController();
    return () => {
      if (currentController.current && !currentController.current.signal.aborted) {
        try { currentController.current.abort("unmount"); } catch {}
      }
    };
  }, [pathname]);

  // 3) Patch fetch once (unchanged; keep if you like)
  useEffect(() => {
    if (patchedRef.current) return;
    patchedRef.current = true;
    const nativeFetch = window.fetch.bind(window);
    // @ts-expect-error augment
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const useInit = init ? { ...init } : {};
      if (!useInit.signal) {
        if (!currentController.current || currentController.current.signal.aborted) {
          currentController.current = new AbortController();
        }
        useInit.signal = currentController.current.signal;
      }
      return nativeFetch(input, useInit);
    };
  }, []);

  // 4) (Optional) extra quiet mode for dev consoles that still log strings like "unmount"
  useEffect(() => {
    const origError = console.error;
    console.error = (...args: any[]) => {
      const noisy = args.some(a => isAbortLike(a) || (typeof a === "string" && a === "unmount"));
      if (noisy) return; // swallow only abort-noise
      return origError(...args);
    };
    return () => { console.error = origError; };
  }, []);

  return children as any;
}
