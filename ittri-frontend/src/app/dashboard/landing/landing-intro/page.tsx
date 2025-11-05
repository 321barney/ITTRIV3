'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Rocket, Sparkles, Zap, ShieldCheck, Code2 } from 'lucide-react';
import { startLanding } from '../lib/landing-starter';

export default function LandingIntroPage() {

  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMounted(true); setYear(new Date().getFullYear()); }, []);
  if (!mounted) return null;

  const onGenerate = () => {
    setBusy(true);
    void startLanding(input);             // start streaming to localStorage
    router.push('/dashboard/landing/studio'); // go to Studio immediately
  };

  return (
    <>
      {/*
        The landing intro page should inherit its look and feel from the global
        design tokens defined in `globals.css`. To avoid overriding these
        defaults with bespoke colors or gradients, the wrapper only
        specifies structural positioning (relative, min height and overflow).
        Color and background are handled by the body element in the global
        layout.
      */}
      <main className="relative min-h-screen overflow-hidden">
{/* Top-right Fast Checkout (client-only download) */}
<div className="fixed right-4 top-4 z-50">
  <Button
    /*
      Use the built‑in secondary variant and default shadow. This
      aligns the button with the token system and avoids hard‑coded
      drop shadows or bespoke colors.
    */
    variant="secondary"
    size="sm"
    onClick={() => {
      try {
        const payload = {
          action: "fast_checkout",
          at: new Date().toISOString(),
          note: "Client-only demo; no network calls",
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "fast-checkout.json";
        document.body.append(a);
requestAnimationFrame(() => {
  try { a.click(); } catch {}
  queueMicrotask(() => { try { a.remove(); } catch {} try { URL.revokeObjectURL(url); } catch {} });
});
      } catch {}
    }}
    title="Download fast checkout receipt"
  >
    <Zap className="mr-1 h-4 w-4" /> Fast Checkout
  </Button>
</div>

      {/* Decorative backdrops are removed to brighten the landing page and align with the overall site theme */}
      {/*<div className="top-aurora" aria-hidden="true" />*/}
      {/*<div className="space-backdrop" aria-hidden="true">
        <div className="stars" />
        <div className="stars stars--sm" />
      </div>*/}

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          {/*
            Instead of a custom gradient, the icon wrapper uses the
            `glass` utility class. This matches the global aesthetics
            (translucent surface with subtle border) and allows the
            foreground color to follow the theme tokens. The Rocket
            icon inherits the current text color.
          */}
          <div className="h-8 w-8 rounded-lg glass grid place-items-center">
            <Rocket className="h-4 w-4" />
          </div>
          <span className="text-xl font-black tracking-tight">ITTRI</span>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-4">LANDING STUDIO</Badge>
          <h1 className="text-5xl font-extrabold leading-tight">
            Welcome to <span className="gradient-text-triple">Landing Studio</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Describe your brand and sections — we’ll stream a polished landing page right into the Studio.
          </p>

          <div className="glass mt-8 rounded-2xl p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              {/*
                Replace the bare textarea with the reusable Textarea component
                from our UI library. It applies token‑driven padding, border,
                and background via the `glass` utility class and supports
                sizes. By default size `md` yields a height similar to the
                previous 56px minimum.
              */}
              <Textarea
                rows={3}
                placeholder="e.g., AI photo app for creatives; hero + features + gallery; primary #00ffff"
                onChange={(e) => setInput(e.target.value)}
                value={input}
              />
              <Button
                disabled={busy}
                onClick={onGenerate}
                variant="futuristic"
                size="lg"
                className="md:self-stretch"
              >
                <Code2 className="mr-2 h-4 w-4" />
                {busy ? 'Generating…' : 'Generate'}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="glass rounded-full px-2 py-0.5">AI • Streaming</span>
              <span className="glass rounded-full px-2 py-0.5">Auto‑enhances short prompts</span>
              <span className="glass rounded-full px-2 py-0.5">Dark / glass / gradients</span>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <Feature icon={Sparkles} title="AI Layouts" text="Hero, features, social proof, pricing, FAQ, and more." />
            <Feature icon={Zap} title="Instant Preview" text="HTML streams into the editor & preview in real time." />
            <Feature icon={ShieldCheck} title="Design System Friendly" text="Respects your glass / gradients / tokens." />
          </div>
        </div>
      </section>

      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-6 text-sm text-muted-foreground">
        © {year ?? ''} ITTRI
      </footer>
      <div className="mt-8 flex gap-2">
        {/*
          Use a token‑driven variant for the checkout button instead of
          hard‑coded emerald colors. The `futuristic` variant conveys
          prominence while remaining consistent with the rest of the UI.
        */}
        <Button
          onClick={() => {
            // Simple client‑side "fast checkout" navigation hook.
            // Replace with your actual checkout route (e.g., Stripe) if available.
            window.location.href = "/checkout?mode=fast";
          }}
          variant="futuristic"
        >
          <Zap className="mr-2 h-4 w-4" /> Fast Checkout
        </Button>
        <Badge variant="outline">1‑click demo</Badge>
      </div>
      </main>
    </>

  );
}

function Feature({
  icon: Icon, title, text,
}: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; title: string; text: string }) {
  return (
    <div className="card-futuristic p-6">
      {/*
        Use the `glass` utility instead of a hard‑coded semi‑transparent
        background for the icon container. This ensures the small badge
        inherits the global border and blur effects.
      */}
      <div className="mb-2 w-fit rounded-xl glass p-2">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
