'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppRouter } from '@/hooks/use-app-router'
import { routes as appRoutes } from '@/lib/routes'
import { ep, postJSON } from '@/lib/endpoints'
import { useUserStore, useUIStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type LoginType = 'user' | 'seller' // "buyer" UI maps to 'user' (handled below)

function AnimatedParticles() {
  const [particles, setParticles] = useState<
    Array<{ id: number; left: number; top: number; delay: number; duration: number }>
  >([])

  useEffect(() => {
    setParticles(
      Array.from({ length: 15 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: Math.random() * 3,
        duration: 3 + Math.random() * 2,
      }))
    )
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute w-1 h-1 bg-cyan-400 rounded-full animate-float"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

export default function LoginPage() {
  // keep your router + stores
  const { go } = useAppRouter()
  const { setUser } = useUserStore()
  const { addNotification } = useUIStore()

  // form state (password name is CORRECT now)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginType, setLoginType] = useState<LoginType>('seller') // default seller
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // if you expose a "Buyer" option in UI, map it to 'user' login_type
      const body = { email, password, login_type: loginType }

      const res = await fetch(ep.auth.login(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // so refresh_token cookie persists
        body: JSON.stringify(body),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error || data?.message || `Login failed (${res.status})`
        setError(msg)
        addNotification({ title: 'Login failed', description: msg, type: 'error' })
        return
      }

      // backend returns: { ok, access_token, user_type, user: {...} }
      setUser({
        id: data.user?.id,
        email: data.user?.email,
        companyName: data.user?.company_name ?? data.user?.companyName,
        planCode: data.user?.plan ?? data.user?.planCode,
        billingCycleStart: data.user?.billing_cycle_start ?? data.user?.billingCycleStart,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: data.user_type === 'seller' ? 'seller' : (data.user?.role ?? 'user'),
        tier: data.user?.tier ?? 'starter',
      })

      addNotification({
        title: 'Signed in',
        description: `Welcome back${data.user?.company_name ? `, ${data.user.company_name}` : ''}!`,
        type: 'success',
      })

      // route: if you have a specific seller dashboard, swap to go.seller()
      // fallback to the existing dashboard helper you already use
      go.dashboard()
    } catch (err: any) {
      const msg = err?.message || 'Network error'
      setError(msg)
      addNotification({ title: 'Network error', description: msg, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4 relative">
      <AnimatedParticles />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black gradient-text-triple mb-2">Neural Access</h1>
          <p className="text-slate-400 text-sm uppercase tracking-wider">
            Authenticate your quantum signature
          </p>
        </div>

        <Card className="card-futuristic border-0">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl font-bold text-white mb-2">
              Login to Neural Interface
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-cyan-400 uppercase tracking-wide">
                  Neural ID
                </label>
                <Input
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your neural identifier"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="glass border-0 bg-white/5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400 h-12 px-4"
                  style={{ color: '#ffffff' }}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-400 uppercase tracking-wide">
                  Quantum Key
                </label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter quantum access key"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass border-0 bg-white/5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-purple-400 h-12 px-4"
                  style={{ color: '#ffffff' }}
                  required
                />
              </div>

              {/* Login type (Seller / Buyer) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-pink-400 uppercase tracking-wide">
                  Identity Channel
                </label>
                <select
                  value={loginType}
                  onChange={(e) => setLoginType(e.target.value as LoginType)}
                  className="glass border-0 bg-white/5 text-white h-12 px-4 rounded-md focus:ring-2 focus:ring-pink-400"
                  style={{ color: '#ffffff' }}
                >
                  <option value="seller">Seller</option>
                  <option value="user">Buyer</option>
                </select>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-700/40 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 btn-futuristic text-white font-semibold uppercase tracking-wide border-0 disabled:opacity-50"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Authenticating...
                  </div>
                ) : (
                  'Access Neural Interface'
                )}
              </Button>
            </form>

            <div className="text-center pt-4 border-t border-white/10">
              <Link
                href={appRoutes.auth.register()}
                className="text-sm text-slate-400 hover:text-cyan-400 transition-colors"
              >
                Need neural clearance? Register here →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
