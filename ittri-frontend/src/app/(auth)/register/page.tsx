'use client'

import { useAppRouter } from '@/hooks/use-app-router'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useUIStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
      })),
    )
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute w-1 h-1 bg-purple-400 rounded-full animate-float"
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

type FormData = {
  email: string
  password: string
  confirmPassword: string
  role: 'seller' | 'buyer'
  tier: 'starter' | 'pro' | 'enterprise'
  store_name: string
  companyName: string
  sellerName: string
  phoneNumber: string
}

export default function RegisterPage() {
  const { go } = useAppRouter()
  const { addNotification } = useUIStore()

  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    role: 'seller',
    tier: 'starter',
    store_name: '',
    companyName: '',
    sellerName: '',
    phoneNumber: '',
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({})
  const [apiKey, setApiKey] = useState<string | null>(null)

  const validateForm = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {}

    if (!formData.email.trim()) e.email = 'Email is required'
    if (!/^\S+@\S+\.\S+$/.test(formData.email)) e.email = 'Invalid email format'

    if (!formData.password.trim()) e.password = 'Password is required'
    if (formData.password.length < 8) e.password = 'Password must be at least 8 characters'
    if (formData.password !== formData.confirmPassword) e.confirmPassword = 'Passwords do not match'

    if (formData.role === 'seller') {
      if (!formData.store_name.trim()) e.store_name = 'Store name is required for sellers'
      if (!formData.companyName.trim()) e.companyName = 'Company is required for sellers'
      if (!formData.sellerName.trim()) e.sellerName = 'Seller name is required for sellers'
      if (!formData.phoneNumber.trim()) e.phoneNumber = 'Phone is required for sellers'
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()

    if (!validateForm()) {
      addNotification({
        title: 'Validation Failed',
        description: 'Please correct the highlighted fields',
        type: 'error',
      })
      return
    }

    setLoading(true)
    try {
      const { confirmPassword, store_name, companyName, sellerName, phoneNumber, ...rest } = formData

      // Map to backend expected keys (camelCase)
      const payload = {
        ...rest, // email, password, role, tier
        storeName: store_name.trim(),
        companyName: companyName.trim(),
        sellerName: sellerName.trim(),
        phoneNumber: phoneNumber.trim(),
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      })

      const raw = await res.text()
      let result: any = null
      try {
        result = JSON.parse(raw)
      } catch {
        result = { raw }
      }

      if (!res.ok) {
        throw new Error(result?.error || res.statusText || 'register_failed')
      }

      const key = result?.apiKey || null
      if (key) {
        setApiKey(key)
        addNotification({
          title: 'Registration Successful',
          description: 'API key generated. Please save it securely.',
          type: 'success',
        })
      } else {
        addNotification({
          title: 'Registration Successful',
          description: 'Account created successfully. Redirecting...',
          type: 'success',
        })
        setTimeout(() => go.login(), 2000)
      }
    } catch (err: any) {
      addNotification({
        title: 'Registration Failed',
        description: String(err?.message || 'Please try again.'),
        type: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4 relative">
      <AnimatedParticles />
      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black gradient-text-triple mb-2">Create Account</h1>
          <p className="text-slate-400 text-sm uppercase tracking-wider">Initialize your neural profile</p>
        </div>

        <Card className="card-futuristic border-0">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl font-bold text-white mb-2">Registration Portal</CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            {!apiKey ? (
              <form id="register-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
                {/* Email */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-400 uppercase tracking-wide">Email *</label>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="your@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`glass border-0 bg-white/5 text-white h-12 px-4 ${
                      errors.email ? 'ring-2 ring-red-400' : ''
                    }`}
                    style={{ color: '#ffffff' }}
                    required
                  />
                  {errors.email && <p className="text-red-400 text-xs">{errors.email}</p>}
                </div>

                {/* Passwords */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-purple-400 uppercase tracking-wide">
                      Password * (min 8)
                    </label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className={`glass border-0 bg-white/5 text-white h-12 px-4 ${
                        errors.password ? 'ring-2 ring-red-400' : ''
                      }`}
                      style={{ color: '#ffffff' }}
                      required
                    />
                    {errors.password && <p className="text-red-400 text-xs">{errors.password}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-pink-400 uppercase tracking-wide">
                      Confirm Password *
                    </label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className={`glass border-0 bg-white/5 text-white h-12 px-4 ${
                        errors.confirmPassword ? 'ring-2 ring-red-400' : ''
                      }`}
                      style={{ color: '#ffffff' }}
                      required
                    />
                    {errors.confirmPassword && <p className="text-red-400 text-xs">{errors.confirmPassword}</p>}
                  </div>
                </div>

                {/* Role & Plan */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-400 uppercase tracking-wide">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) =>
                      setFormData({ ...formData, role: e.target.value as 'seller' | 'buyer' })
                    }
                    className="glass border-0 bg-white/5 text-white h-12 px-4 w-full rounded-md"
                  >
                    <option value="seller" className="bg-slate-800">
                      Seller
                    </option>
                    <option value="buyer" className="bg-slate-800">
                      Buyer
                    </option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-orange-400 uppercase tracking-wide">Plan</label>
                  <select
                    value={formData.tier}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        tier: e.target.value as 'starter' | 'pro' | 'enterprise',
                      })
                    }
                    className="glass border-0 bg-white/5 text-white h-12 px-4 w-full rounded-md"
                  >
                    <option value="starter" className="bg-slate-800">
                      Starter - $29/month
                    </option>
                    <option value="pro" className="bg-slate-800">
                      Pro - $99/month
                    </option>
                    <option value="enterprise" className="bg-slate-800">
                      Enterprise - Custom
                    </option>
                  </select>
                </div>

                {/* Seller-only fields */}
                {formData.role === 'seller' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-blue-400 uppercase tracking-wide">
                        Store Name *
                      </label>
                      <Input
                        type="text"
                        placeholder="Your Store Name"
                        value={formData.store_name}
                        onChange={(e) => setFormData({ ...formData, store_name: e.target.value })}
                        className={`glass border-0 bg-white/5 text-white h-12 px-4 ${
                          errors.store_name ? 'ring-2 ring-red-400' : ''
                        }`}
                        style={{ color: '#ffffff' }}
                        required
                      />
                      {errors.store_name && <p className="text-red-400 text-xs">{errors.store_name}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-cyan-400 uppercase tracking-wide">
                        Company *
                      </label>
                      <Input
                        type="text"
                        placeholder="Your Company"
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        className={`glass border-0 bg-white/5 text-white h-12 px-4 ${
                          errors.companyName ? 'ring-2 ring-red-400' : ''
                        }`}
                        style={{ color: '#ffffff' }}
                        required
                      />
                      {errors.companyName && <p className="text-red-400 text-xs">{errors.companyName}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-teal-400 uppercase tracking-wide">
                          Seller Name *
                        </label>
                        <Input
                          type="text"
                          placeholder="e.g., John Doe"
                          value={formData.sellerName}
                          onChange={(e) => setFormData({ ...formData, sellerName: e.target.value })}
                          className="glass border-0 bg-white/5 text-white h-12 px-4"
                          style={{ color: '#ffffff' }}
                          required
                        />
                        {errors.sellerName && <p className="text-red-400 text-xs">{errors.sellerName}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-amber-400 uppercase tracking-wide">
                          Phone *
                        </label>
                        <Input
                          type="tel"
                          placeholder="+1 555 123 4567"
                          value={formData.phoneNumber}
                          onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                          className="glass border-0 bg-white/5 text-white h-12 px-4"
                          style={{ color: '#ffffff' }}
                          required
                        />
                        {errors.phoneNumber && <p className="text-red-400 text-xs">{errors.phoneNumber}</p>}
                      </div>
                    </div>
                  </>
                )}

                <Button
                  type="submit"
                  form="register-form"
                  disabled={loading}
                  className="w-full h-12 btn-futuristic text-white font-semibold uppercase tracking-wide border-0 disabled:opacity-50 mt-6"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating Account...
                    </div>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </form>
            ) : (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-r from-green-400 to-cyan-500 flex items-center justify-center">
                  <div className="text-2xl">✓</div>
                </div>
                <h3 className="text-xl font-semibold text-green-400">Account Created!</h3>

                <div className="glass p-4 rounded-lg border border-yellow-400/30">
                  <h4 className="text-yellow-400 font-semibold mb-2">⚠️ Save Your API Key</h4>
                  <div className="bg-black/50 p-3 rounded font-mono text-sm text-cyan-400 break-all border border-cyan-400/30">
                    {apiKey}
                  </div>
                  <Button
                    onClick={() => apiKey && navigator.clipboard.writeText(apiKey)}
                    variant="outline"
                    className="w-full mt-3 glass border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10"
                  >
                    Copy to Clipboard
                  </Button>
                </div>

                <Button
                  onClick={() => go.login()}
                  className="w-full h-12 btn-futuristic text-white font-semibold uppercase tracking-wide border-0"
                >
                  Continue to Login
                </Button>
              </div>
            )}

            {!apiKey && (
              <div className="text-center pt-4 border-t border-white/10">
                <Link
                  href="/auth/login"
                  className="text-sm text-slate-400 hover:text-cyan-400 transition-colors"
                >
                  Already have an account? Login here →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
