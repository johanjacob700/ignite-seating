// Public seating view — read-only, live-updating.
// Anyone with the link can see available seats in real time.
// No login required.

import SeatingChart from '@/components/SeatingChart'
import ThemeToggle from '@/components/ThemeToggle'
import Link from 'next/link'

export default function PublicPage() {
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Flame icon matching Ignite brand */}
            <div className="w-9 h-9 rounded-full bg-[#BE1E2D] flex items-center justify-center shadow-lg shadow-red-900/40">
              <span className="text-white text-base">🔥</span>
            </div>
            <div>
              <div className="text-white font-extrabold text-lg tracking-widest uppercase">
                Ignite Church
              </div>
              <div className="text-zinc-400 text-xs tracking-wide">Newark, NJ — Live Seating</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/admin"
              className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
            >
              Usher Admin →
            </Link>
          </div>
        </div>
      </header>

      {/* Hero tagline */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
            Sunday Seating
          </h1>
          <p className="text-zinc-400 mt-1 text-sm sm:text-base">
            Find your seat — this chart updates live as ushers check people in.
          </p>
        </div>
      </div>

      {/* Live seating chart */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <SeatingChart isAdmin={false} />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-zinc-600 text-xs">
            © {new Date().getFullYear()} Ignite Church Newark · 1100 McCarter Hwy, Newark, NJ 07102
          </p>
          <p className="text-zinc-600 text-xs">Sundays at 11am · Upper Level</p>
        </div>
      </footer>
    </div>
  )
}
