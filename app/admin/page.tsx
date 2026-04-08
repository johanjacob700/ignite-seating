'use client'

// Admin page — password-protected view for ushers.
// Has two tabs:
//   "Seating" — the live seat chart with toggle/select/reset controls
//   "Layout"  — the dynamic layout builder with saved favorites
//
// Navigation:
//   Desktop: tab bar inside the sticky header
//   Mobile:  fixed bottom navigation bar (keeps main content visible)

import { useState } from 'react'
import SeatingChart from '@/components/SeatingChart'
import LayoutEditor from '@/components/LayoutEditor'
import AttendanceSubmit from '@/components/AttendanceSubmit'
import ServiceTimer from '@/components/ServiceTimer'
import ThemeToggle from '@/components/ThemeToggle'
import { SectionConfig } from '@/lib/supabase'

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? 'ignite2024'

type Tab = 'seating' | 'layout'

export default function AdminPage() {
  const [authenticated, setAuthenticated]       = useState(false)
  const [password, setPassword]                 = useState('')
  const [authError, setAuthError]               = useState(false)
  const [resetTrigger, setResetTrigger]         = useState(0)
  const [layoutMeta, setLayoutMeta]             = useState<SectionConfig[]>([])
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [activeTab, setActiveTab]               = useState<Tab>('seating')
  // Incremented when the layout editor applies a new layout, forcing SeatingChart to reload
  const [layoutVersion, setLayoutVersion]       = useState(0)

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true)
      setAuthError(false)
    } else {
      setAuthError(true)
    }
  }

  const handleReset = () => {
    setResetTrigger(n => n + 1)
    setShowResetConfirm(false)
  }

  // Called by LayoutEditor after a new layout is applied.
  // Switching back to the Seating tab and bumping layoutVersion re-mounts SeatingChart
  // so it fetches the fresh seat data.
  const handleLayoutApplied = () => {
    setLayoutVersion(v => v + 1)
    setActiveTab('seating')
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">

          {/* Brand mark */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#BE1E2D] flex items-center justify-center shadow-lg shadow-red-950/50">
              <span className="text-2xl">🔥</span>
            </div>
            <div className="leading-tight">
              <p className="text-white font-black text-lg tracking-widest uppercase">Ignite</p>
              <p className="text-zinc-500 text-xs tracking-wide">Newark, NJ</p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-white text-2xl font-black">Usher Access</h1>
              <p className="text-zinc-500 text-sm">Enter the admin password to manage seating</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="password"
                placeholder="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 focus:outline-none focus:border-[#BE1E2D] transition-colors text-sm"
              />
              {authError && (
                <p className="text-red-400 text-sm text-center">Incorrect password. Try again.</p>
              )}
              <button
                type="submit"
                className="w-full bg-[#BE1E2D] hover:bg-[#9e1826] text-white font-black py-3.5 rounded-xl transition-colors tracking-wide"
              >
                Enter Admin View
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // ── Admin dashboard ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">

          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#BE1E2D] flex items-center justify-center shadow-md shadow-red-950/50">
              <span className="text-base">🔥</span>
            </div>
            <div className="leading-tight">
              <p className="text-white font-black text-sm tracking-widest uppercase">Ignite</p>
              <p className="text-zinc-500 text-[10px] tracking-wide -mt-0.5">Usher Admin</p>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {/* Reset button visible on desktop only — mobile uses bottom nav */}
            {activeTab === 'seating' && (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="hidden sm:block text-zinc-500 hover:text-zinc-300 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Reset Seats
              </button>
            )}
            <button
              onClick={() => setAuthenticated(false)}
              className="text-zinc-500 hover:text-zinc-300 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Desktop tab bar — hidden on mobile (bottom nav handles it) */}
        <div className="hidden sm:flex max-w-7xl mx-auto px-4 sm:px-6 gap-1 border-t border-zinc-800/40">
          {(['seating', 'layout'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[#BE1E2D] text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'seating' ? 'Seating' : 'Layout'}
            </button>
          ))}
        </div>
      </header>

      {/* Admin hint — seating tab, desktop only */}
      {activeTab === 'seating' && (
        <div className="hidden sm:block bg-[#BE1E2D]/10 border-b border-[#BE1E2D]/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
            <p className="text-[#e05060] text-sm">
              <span className="font-bold">Admin mode:</span> Tap any seat to toggle it. Use &ldquo;Find Seats&rdquo; to place groups quickly.
            </p>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 pb-28 sm:pb-8">
        {activeTab === 'seating' ? (
          <div className="space-y-4">
            {/* Service countdown timer + reminder banners */}
            <ServiceTimer layoutMeta={layoutMeta} />
            {/* Submit attendance + history */}
            <AttendanceSubmit layoutMeta={layoutMeta} />
            {/* key={layoutVersion} forces a full remount + data reload when a new layout is applied */}
            <SeatingChart
              key={layoutVersion}
              isAdmin={true}
              resetTrigger={resetTrigger}
              onLayoutLoaded={setLayoutMeta}
            />
          </div>
        ) : (
          <div>
            <div className="mb-5">
              <h2 className="text-white text-xl font-bold">Seating Layout</h2>
              <p className="text-zinc-500 text-sm mt-1">
                Configure sections, rows, and columns. Save layouts to favorites for quick reuse.
              </p>
            </div>
            <LayoutEditor onLayoutApplied={handleLayoutApplied} />
          </div>
        )}
      </main>

      {/* ── Mobile bottom navigation ── */}
      {/* Replaces the header tab bar on small screens. Fixed at the bottom so the
          seating chart always has full viewport height available above. */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 bg-zinc-950/95 backdrop-blur border-t border-zinc-800/60 safe-area-bottom">
        <div className="flex h-16">
          <button
            onClick={() => setActiveTab('seating')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'seating' ? 'text-white' : 'text-zinc-600'
            }`}
          >
            <span className="text-xl leading-none">🪑</span>
            <span className="text-[11px] font-semibold">Seating</span>
            {activeTab === 'seating' && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-[#BE1E2D] rounded-b-full" />
            )}
          </button>

          {/* Reset — centre tap target on mobile */}
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-zinc-600 transition-colors"
          >
            <span className="text-xl leading-none">↺</span>
            <span className="text-[11px] font-semibold">Reset</span>
          </button>

          <button
            onClick={() => setActiveTab('layout')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'layout' ? 'text-white' : 'text-zinc-600'
            }`}
          >
            <span className="text-xl leading-none">🏗️</span>
            <span className="text-[11px] font-semibold">Layout</span>
            {activeTab === 'layout' && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-[#BE1E2D] rounded-b-full" />
            )}
          </button>
        </div>
      </nav>

      {/* ── Reset confirmation modal ── */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full space-y-5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto">
              <span className="text-3xl">↺</span>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-white text-xl font-bold">Reset all seats?</h2>
              <p className="text-zinc-500 text-sm">
                This will mark every seat as vacant. Use this between services.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 bg-[#BE1E2D] hover:bg-[#9e1826] text-white font-bold py-3 rounded-xl transition-colors"
              >
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
