'use client'

// Admin page — password-protected view for ushers.
// Has two tabs:
//   "Seating" — the live seat chart with toggle/select/reset controls
//   "Layout"  — the dynamic layout builder with saved favorites

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
        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#BE1E2D] flex items-center justify-center">
                <span className="text-white text-xl">🔥</span>
              </div>
              <span className="text-white font-bold text-xl tracking-wide">IGNITE CHURCH</span>
            </div>
            <h1 className="text-white text-2xl font-bold">Usher Admin</h1>
            <p className="text-zinc-400 text-sm">Enter the admin password to manage seating</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-[#BE1E2D] transition-colors"
            />
            {authError && (
              <p className="text-red-400 text-sm text-center">Incorrect password. Try again.</p>
            )}
            <button
              type="submit"
              className="w-full bg-[#BE1E2D] hover:bg-[#9e1826] text-white font-bold py-3 rounded-lg transition-colors"
            >
              Enter Admin View
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Admin dashboard ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#BE1E2D] flex items-center justify-center shrink-0">
              <span className="text-white text-sm">🔥</span>
            </div>
            <div>
              <span className="text-white font-bold text-base tracking-wide">IGNITE</span>
              <span className="text-zinc-400 text-sm ml-1.5 hidden sm:inline">Church</span>
              <span className="text-zinc-500 text-xs ml-2">Admin</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {activeTab === 'seating' && (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <span className="hidden sm:inline">Reset All Seats</span>
                <span className="sm:hidden">Reset</span>
              </button>
            )}
            <button
              onClick={() => setAuthenticated(false)}
              className="text-zinc-500 hover:text-zinc-300 text-xs sm:text-sm transition-colors px-1 py-2"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 pb-0">
          {(['seating', 'layout'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${
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

      {/* Instruction banner — seating tab only, hidden on mobile to save space */}
      {activeTab === 'seating' && (
        <div className="bg-[#BE1E2D]/10 border-b border-[#BE1E2D]/20 hidden sm:block">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
            <p className="text-[#e05060] text-sm">
              <span className="font-bold">Admin mode:</span> Click any seat to toggle it. Use "Select seats" to update multiple at once.
            </p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 sm:pb-8">
        {activeTab === 'seating' ? (
          <div className="space-y-5">
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
            <div className="mb-6">
              <h2 className="text-white text-xl font-bold">Seating Layout</h2>
              <p className="text-zinc-400 text-sm mt-1">
                Configure the number of sections, rows, and columns. Save layouts to favorites for quick reuse.
              </p>
            </div>
            <LayoutEditor onLayoutApplied={handleLayoutApplied} />
          </div>
        )}
      </main>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full space-y-5 text-center">
            <h2 className="text-white text-xl font-bold">Reset all seats?</h2>
            <p className="text-zinc-400 text-sm">
              This will mark every seat as vacant. Use this between services.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 bg-[#BE1E2D] hover:bg-[#9e1826] text-white font-bold py-2.5 rounded-lg transition-colors"
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
