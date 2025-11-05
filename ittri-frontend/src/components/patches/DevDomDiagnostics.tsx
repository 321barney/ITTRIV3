'use client';

import { useEffect } from 'react';

export default function DevDomDiagnostics(): null {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const NodeProto: any = (window as any).Node?.prototype;
      if (!NodeProto) return;
      const orig = NodeProto.removeChild;
      if (!orig || NodeProto.__diagPatched) return;
      NodeProto.__diagPatched = true;
      NodeProto.removeChild = function(child: Node) {
        try {
          return orig.call(this, child);
        } catch (e) {
          if ((e as any)?.name === 'NotFoundError') {
            // dump some context to help find the culprit
            // Avoid crashing, but print useful info.
            try {
              // eslint-disable-next-line no-console
              console.error('DevDomDiagnostics NotFoundError', {
                parent: this,
                child,
                parentChildren: (this as any)?.childNodes?.length
              });
            } catch {}
            // Re-throw so error overlay still shows in dev (optional)
            // throw e;
            // Or swallow to keep dev UX smooth:
            return child;
          }
          throw e;
        }
      };
    } catch {}
  }, []);
  return null;
}
