// src/app/page.tsx
'use client';

import { useMemo } from 'react';
import { useAppRouter } from '@/hooks/use-app-router';
import { useUserStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function LandingPage() {
  const { go } = useAppRouter();
  const { user } = useUserStore();

  const cta = useMemo(
    () =>
      user
        ? { primary: { label: 'Go to dashboard', action: () => go.dashboard() } }
        : {
            primary: { label: 'Create account', action: () => go.register() },
            secondary: { label: 'Log in', action: () => go.login() },
          },
    [user, go]
  );

  return (
    
      <main id="main-content" className="landing-force-dark relative min-h-screen overflow-hidden bg-transparent text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 z-50 bg-background px-3 py-2 rounded">Skip to content</a>
      {/* Top aurora line (global class animates it) */}
      <div className="top-aurora" aria-hidden />

      {/* Starfield sits behind all content */}
      <div className="space-backdrop" aria-hidden>
        <div className="stars" />
        <div className="stars stars--sm" />
      </div>

      {/* HEADER */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-foreground/10" />
          <span className="text-xl font-black tracking-tight">ITTRI</span>
        </div>

        <nav className="flex items-center gap-3">
          {!user ? (
            <>
              <Button
                onClick={() => go.login()}
                className="bg-transparent px-0 text-sm text-muted-foreground hover:text-foreground"
                aria-label="Log in"
              >
                Log in
              </Button>

              <Button
                onClick={() => go.register()}
                className="btn-futuristic rounded-lg px-4 py-2 text-sm font-semibold"
                aria-label="Create account"
              >
                Create account
              </Button>
            </>
          ) : (
            <Button
              onClick={() => go.dashboard()}
              className="btn-futuristic rounded-lg px-4 py-2 text-sm font-semibold"
              aria-label="Open dashboard"
            >
              Open dashboard
            </Button>
          )}
        </nav>
      </header>

      {/* HERO */}
      <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 pt-8">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-5xl font-extrabold leading-tight">
              Automate your e-commerce with <span className="gradient-text-triple">ITTRI</span>
            </h1>
            <p className="mt-5 max-w-xl text-muted-foreground">
              Centralize orders, products, and AI conversations. Real-time metrics the moment
              you connect your store — delightful UX out of the box.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Button
                onClick={cta.primary.action}
                className="btn-futuristic rounded-xl px-6 py-3 text-base font-semibold"
              >
                {cta.primary.label}
              </Button>

              {!user && 'secondary' in cta && cta.secondary && (
                <Button
                  onClick={cta.secondary.action}
                  className="btn-outline rounded-xl px-6 py-3 text-base"
                >
                  {cta.secondary.label}
                </Button>
              )}
            </div>

            {/* Social proof / tiny stats */}
            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/40" />
                Uptime 99.98%
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/40" />
                Built-in AI confirmations
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/40" />
                Realtime analytics
              </div>
            </div>
          </div>

          {/* Right side visual */}
          <div className="relative">
            <Card className="card-futuristic p-6">
              <div className="mb-4 text-sm font-semibold text-muted-foreground">Live Preview</div>

              <div className="grid grid-cols-2 gap-4">
                <div className="glass rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Orders today</div>
                  <div className="mt-1 text-2xl font-bold">142</div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">AI confirmations</div>
                  <div className="mt-1 text-2xl font-bold">84.7%</div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Revenue</div>
                  <div className="mt-1 text-2xl font-bold">$18.4k</div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Avg response</div>
                  <div className="mt-1 text-2xl font-bold">2.3s</div>
                </div>
              </div>

              <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
                <div className="gradient-progress h-full w-1/3" />
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { title: 'Unified dashboard', desc: 'Orders, products, and conversations in one clean view.' },
            { title: 'AI confirmations', desc: 'Automated decisions with human-in-the-loop when needed.' },
            { title: 'Developer-friendly', desc: 'Typed endpoints, modern stack, and simple webhooks.' },
          ].map((f) => (
            <Card key={f.title} className="card-futuristic p-6">
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-10 text-sm text-muted-foreground">
        © {new Date().getFullYear()} ITTRI. All rights reserved.
      </footer>
    </main>
  );
}
