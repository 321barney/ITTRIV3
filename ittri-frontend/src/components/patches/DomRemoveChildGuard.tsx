'use client';

import { useEffect } from 'react';

/**
 * Guards against NotFoundError: removeChild on Node when some third-party code
 * or double-invoked effects (React StrictMode in dev) try to remove a node
 * that has already been reparented/removed. This keeps the app from crashing
 * while we track the root cause.
 */
export default function DomRemoveChildGuard(): null {
  useEffect(() => {
    try {
      const NodeProto: any = (window as any).Node?.prototype;
      if (!NodeProto) return;

      const origRemoveChild = NodeProto.removeChild;
      if (origRemoveChild && !NodeProto.__patchedRemoveChild) {
        Object.defineProperty(NodeProto, '__patchedRemoveChild', { value: true });
        NodeProto.removeChild = function(child: Node) {
          // If this node is no longer a child of the parent, just ignore.
          if (!child || (child as any).parentNode !== this) {
            return child;
          }
          try {
            return origRemoveChild.call(this, child);
          } catch (e) {
            // Swallow NotFoundError specifically; rethrow others to avoid hiding real bugs
            if ((e as any)?.name === 'NotFoundError') {
              return child;
            }
            throw e;
          }
        };
      }
    } catch {}
  }, []);

  return null;
}
