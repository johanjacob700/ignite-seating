// Public seating view — read-only, live-updating.
// Anyone with the link can see available seats in real time.
// No login required.

import SeatingChart from '@/components/SeatingChart'
import ThemeToggle from '@/components/ThemeToggle'
import Link from 'next/link'

export default function PublicPage() {
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
              <p className="text-zinc-500 text-[10px] tracking-wide -mt-0.5">Newark, NJ</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/admin"
              className="text-zinc-500 hover:text-zinc-300 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Ushers
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border-b border-zinc-800/40 px-4 sm:px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-emerald-400 text-xs font-semibold tracking-wide uppercase">Live · Updates in real time</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Sunday Seating
        </h1>
        <p className="text-zinc-400 mt-1 text-sm">
          Find your seat — ushers update this chart as people arrive.
        </p>
      </div>

      {/* ── Seating chart ── */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 pb-10">
        <SeatingChart isAdmin={false} />
      </main>

      {/* ── Minimal footer ── */}
      <footer className="border-t border-zinc-800/40 px-4 py-4 text-center">
        <p className="text-zinc-700 text-xs">Sundays 11:00 AM · Ignite Church Newark</p>
      </footer>

    </div>
  )
}
