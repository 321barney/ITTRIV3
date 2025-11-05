'use client';

import React, { useEffect, useRef } from 'react';

export function PreviewIframe({ html, title, className }: { html: string; title?: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.srcdoc = html || '';
  }, [html]);
  return (
    <iframe
      ref={ref}
      title={title || 'Preview'}
      className={className}
      sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
    />
  );
}

export function CodeWorkbench({
  code, setCode, previewHtml, setPreviewHtml, onRun,
}: {
  code: string;
  setCode: (v: string) => void;
  previewHtml: string;
  setPreviewHtml: (v: string) => void;
  onRun: () => void;
}) {
  const download = () => {
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'landing.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const openTab = () => {
    const w = window.open('', '_blank'); if (!w) return;
    w.document.open(); w.document.write(previewHtml); w.document.close();
  };

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[42%_1fr]">
      <section className="min-h-[70vh]">
        <div className="glass rounded-xl p-3 h-full card-futuristic flex flex-col">
          <div className="text-xs on-dark mb-2">index.html</div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="flex-1 w-full resize-none rounded-lg bg-black/20 p-3 font-mono text-xs leading-5 outline-none"
            spellCheck={false}
          />
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary px-3 py-1.5 rounded" onClick={onRun}>Run</button>
            <button className="btn px-3 py-1.5 rounded" onClick={download}>Download</button>
            <button className="btn px-3 py-1.5 rounded" onClick={openTab}>Open</button>
          </div>
        </div>
      </section>

      <section className="min-h-[70vh]">
        <div className="glass rounded-xl p-3 h-full card-futuristic">
          <div className="text-xs on-dark mb-2">Live Preview</div>
          <div className="h-[calc(100%-18px)] rounded-xl overflow-hidden border border-white/10">
            <PreviewIframe html={previewHtml} className="h-full w-full" title="Preview" />
          </div>
        </div>
      </section>
    </div>
  );
}
