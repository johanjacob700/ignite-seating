'use client'

// AttendanceSubmit — lets ushers record attendance at the end of each service.
//
// When "Submit Attendance" is clicked:
//   1. Fetches the latest seat data fresh from Supabase
//   2. Runs an efficiency analysis on the seating pattern
//   3. Shows a confirmation modal with stats + recommendations
//   4. On confirm, saves the record to the `attendance` table
//
// Also shows a history of past submissions so the team can track trends.

import { useState } from 'react'
import { supabase, Seat, SectionConfig, AttendanceRecord, SectionStat } from '@/lib/supabase'

// ── Efficiency analysis ───────────────────────────────────────────────────────

interface EfficiencyResult {
  score: number           // 0–100
  sectionStats: SectionStat[]
  notes: string[]         // actionable recommendations
}

function analyzeEfficiency(seats: Seat[], layoutMeta: SectionConfig[]): EfficiencyResult {
  const notes: string[] = []
  let score = 100

  // Per-section breakdown
  const sectionStats: SectionStat[] = layoutMeta.map(sec => {
    const s = seats.filter(x => x.section === sec.label)
    const occupied = s.filter(x => x.status === 'occupied').length
    const reserved = s.filter(x => x.status === 'reserved').length
    const vacant   = s.filter(x => x.status === 'vacant').length
    return { label: sec.label, total: s.length, occupied, reserved, vacant, rate: (occupied + reserved) / Math.max(s.length, 1) }
  })

  // ── Check 1: Front-fill gaps ───────────────────────────────────────────────
  // A section has a gap when there are vacant seats in earlier rows while later
  // rows have people sitting in them — people skipped rows instead of filling front first.
  for (const sec of layoutMeta) {
    const secSeats = seats.filter(s => s.section === sec.label)
    const occupiedRows = secSeats.filter(s => s.status !== 'vacant').map(s => s.row_number)
    if (occupiedRows.length === 0) continue

    const maxOccupiedRow = Math.max(...occupiedRows)
    // Rows that have at least one vacant seat and are before the last occupied row
    const rowsWithVacant = new Set(
      secSeats
        .filter(s => s.status === 'vacant' && s.row_number < maxOccupiedRow)
        .map(s => s.row_number)
    )
    if (rowsWithVacant.size > 0) {
      const skipped = [...rowsWithVacant].sort((a, b) => a - b)
      notes.push(
        `Section ${sec.label}: rows ${skipped.join(', ')} have empty seats while later rows are used — seat people front-to-back next time.`
      )
      score -= Math.min(20, skipped.length * 5)
    }
  }

  // ── Check 2: Isolated single vacant seats ─────────────────────────────────
  // A vacant seat that has occupied/reserved neighbours on both sides in the same
  // row is effectively wasted — no one can comfortably sit there alone.
  let isolatedCount = 0
  for (const sec of layoutMeta) {
    const secSeats = seats.filter(s => s.section === sec.label)
    const byRow = new Map<number, Seat[]>()
    for (const seat of secSeats) {
      if (!byRow.has(seat.row_number)) byRow.set(seat.row_number, [])
      byRow.get(seat.row_number)!.push(seat)
    }
    for (const rowSeats of byRow.values()) {
      const sorted = [...rowSeats].sort((a, b) => a.col_number - b.col_number)
      for (let i = 1; i < sorted.length - 1; i++) {
        const prev = sorted[i - 1].status !== 'vacant'
        const curr = sorted[i].status === 'vacant'
        const next = sorted[i + 1].status !== 'vacant'
        if (prev && curr && next) isolatedCount++
      }
    }
  }
  if (isolatedCount > 0) {
    notes.push(
      `${isolatedCount} isolated seat${isolatedCount > 1 ? 's' : ''} ended up trapped between occupied seats — they can't be used. Try to keep vacant seats in groups.`
    )
    score -= Math.min(15, isolatedCount * 3)
  }

  // ── Check 3: Section imbalance ────────────────────────────────────────────
  // If one section is much more full than another it suggests ushers didn't
  // spread people evenly across the venue.
  const rates = sectionStats.map(s => s.rate)
  const maxRate = Math.max(...rates)
  const minRate = Math.min(...rates)
  if (maxRate - minRate > 0.4 && minRate < 0.5) {
    const full  = sectionStats.find(s => s.rate === maxRate)!.label
    const empty = sectionStats.find(s => s.rate === minRate)!.label
    notes.push(
      `Section ${full} filled much faster than Section ${empty}. Direct incoming people to the emptier section earlier to balance the load.`
    )
    score -= 10
  }

  // ── Check 4: Low overall occupancy ───────────────────────────────────────
  const totalUsed  = seats.filter(s => s.status !== 'vacant').length
  const totalSeats = seats.length
  const rate = totalUsed / Math.max(totalSeats, 1)
  if (rate < 0.3) {
    notes.push(`Only ${Math.round(rate * 100)}% of seats were used. Consider consolidating seating to fewer sections to keep the energy concentrated near the front.`)
    score -= 10
  }

  if (notes.length === 0) {
    notes.push('Great job! Seating was efficient — people filled from the front and no seats were wasted.')
  }

  return { score: Math.max(0, Math.min(100, score)), sectionStats, notes }
}

// ── Score badge colour ────────────────────────────────────────────────────────
function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 55) return 'text-amber-400'
  return 'text-red-400'
}
function scoreLabel(score: number) {
  if (score >= 80) return 'Efficient'
  if (score >= 55) return 'Fair'
  return 'Needs Improvement'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  layoutMeta: SectionConfig[]
}

export default function AttendanceSubmit({ layoutMeta }: Props) {
  const [open, setOpen]             = useState(false)
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]       = useState<AttendanceRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // Free-text note for the service (e.g. "Easter Sunday", "Guest speaker")
  const [serviceNote, setServiceNote] = useState('')

  // Analysis result built when the modal opens
  const [analysis, setAnalysis]     = useState<{
    seats: Seat[]
    result: EfficiencyResult
    serviceDate: string
  } | null>(null)

  // Open modal: fetch latest seats + run analysis
  const handleOpen = async () => {
    setLoading(true)
    setOpen(true)
    setSaved(false)
    setServiceNote('')

    const { data: seats } = await supabase.from('seats').select('*')
    if (!seats) { setLoading(false); return }

    const today = new Date().toISOString().split('T')[0]
    const result = analyzeEfficiency(seats as Seat[], layoutMeta)
    setAnalysis({ seats: seats as Seat[], result, serviceDate: today })
    setLoading(false)
  }

  // Save the attendance record to Supabase
  const handleSave = async () => {
    if (!analysis) return
    setSaving(true)

    const { seats, result, serviceDate } = analysis
    const totalOccupied = seats.filter(s => s.status === 'occupied').length
    const totalReserved = seats.filter(s => s.status === 'reserved').length
    const totalVacant   = seats.filter(s => s.status === 'vacant').length

    await supabase.from('attendance').insert({
      service_date:      serviceDate,
      total_occupied:    totalOccupied,
      total_reserved:    totalReserved,
      total_vacant:      totalVacant,
      total_seats:       seats.length,
      efficiency_score:  result.score,
      section_breakdown: result.sectionStats,
      efficiency_notes:  result.notes,
      service_note:      serviceNote.trim() || null,
    })

    setSaving(false)
    setSaved(true)
  }

  // Load attendance history
  const handleViewHistory = async () => {
    setShowHistory(true)
    setHistoryLoading(true)
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .order('service_date', { ascending: false })
      .limit(20)
    setHistory((data as AttendanceRecord[]) ?? [])
    setHistoryLoading(false)
  }

  return (
    <>
      {/* Trigger buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleOpen}
          className="bg-[#BE1E2D] hover:bg-[#9e1826] text-white text-sm font-bold px-4 py-2.5 rounded-lg transition-colors"
        >
          Submit Attendance
        </button>
        <button
          onClick={handleViewHistory}
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          History
        </button>
      </div>

      {/* ── Submission modal ── */}
      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-white text-lg font-bold">Submit Sunday Attendance</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {loading && (
                <p className="text-zinc-400 text-sm text-center py-6">Analysing seating…</p>
              )}

              {!loading && analysis && !saved && (
                <>
                  {/* Date */}
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-sm">Service date</span>
                    <input
                      type="date"
                      value={analysis.serviceDate}
                      onChange={e => setAnalysis({ ...analysis, serviceDate: e.target.value })}
                      className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-[#BE1E2D]"
                    />
                  </div>

                  {/* Service note */}
                  <div className="space-y-1.5">
                    <label className="text-zinc-400 text-sm">Service note <span className="text-zinc-600">(optional)</span></label>
                    <input
                      type="text"
                      placeholder="e.g. Easter Sunday, Guest speaker, Youth Sunday…"
                      value={serviceNote}
                      onChange={e => setServiceNote(e.target.value)}
                      maxLength={100}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-[#BE1E2D] transition-colors"
                    />
                  </div>

                  {/* Attendance counts */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Occupied', value: analysis.seats.filter(s => s.status === 'occupied').length, color: 'text-red-400' },
                      { label: 'Reserved', value: analysis.seats.filter(s => s.status === 'reserved').length, color: 'text-amber-400' },
                      { label: 'Vacant',   value: analysis.seats.filter(s => s.status === 'vacant').length,   color: 'text-emerald-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-zinc-800 rounded-xl p-3 text-center">
                        <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
                        <div className="text-zinc-500 text-xs mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Section breakdown */}
                  <div className="space-y-2">
                    <p className="text-zinc-400 text-xs uppercase tracking-wide font-semibold">Section breakdown</p>
                    {analysis.result.sectionStats.map(s => (
                      <div key={s.label} className="flex items-center gap-3">
                        <span className="text-zinc-300 text-sm font-semibold w-12">Sec {s.label}</span>
                        {/* Progress bar */}
                        <div className="flex-1 bg-zinc-800 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="h-full bg-[#BE1E2D] rounded-full transition-all"
                            style={{ width: `${Math.round(s.rate * 100)}%` }}
                          />
                        </div>
                        <span className="text-zinc-400 text-xs w-10 text-right">{Math.round(s.rate * 100)}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Efficiency score */}
                  <div className="bg-zinc-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-zinc-300 text-sm font-semibold">Seating efficiency</p>
                      <span className={`text-2xl font-extrabold ${scoreColor(analysis.result.score)}`}>
                        {analysis.result.score}/100
                        <span className={`text-xs ml-1.5 font-semibold ${scoreColor(analysis.result.score)}`}>
                          {scoreLabel(analysis.result.score)}
                        </span>
                      </span>
                    </div>

                    {/* Recommendations */}
                    <ul className="space-y-2">
                      {analysis.result.notes.map((note, i) => (
                        <li key={i} className="flex gap-2 text-sm text-zinc-400">
                          <span className="mt-0.5 shrink-0">
                            {analysis.result.score >= 80 ? '✓' : '→'}
                          </span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Save button */}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full bg-[#BE1E2D] hover:bg-[#9e1826] disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save Attendance Record'}
                  </button>
                </>
              )}

              {/* Success state */}
              {saved && (
                <div className="text-center py-6 space-y-3">
                  <div className="text-4xl">✅</div>
                  <p className="text-white font-bold text-lg">Attendance saved!</p>
                  <p className="text-zinc-400 text-sm">
                    Record stored for {analysis?.serviceDate}
                    {serviceNote.trim() ? ` · ${serviceNote.trim()}` : ''}.
                  </p>
                  <button
                    onClick={() => setOpen(false)}
                    className="mt-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── History modal ── */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-white text-lg font-bold">Attendance History</h2>
              <button onClick={() => setShowHistory(false)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-3">
              {historyLoading && (
                <p className="text-zinc-400 text-sm text-center py-6">Loading…</p>
              )}
              {!historyLoading && history.length === 0 && (
                <p className="text-zinc-500 text-sm text-center py-6">No records yet. Submit attendance after a service to start tracking.</p>
              )}
              {!historyLoading && history.map(rec => (
                <div key={rec.id} className="bg-zinc-800 rounded-xl px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-white font-semibold text-sm block">
                        {new Date(rec.service_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      {/* Service note badge */}
                      {(rec as AttendanceRecord & { service_note?: string }).service_note && (
                        <span className="inline-block mt-1 bg-[#BE1E2D]/20 text-[#e05060] text-xs font-semibold px-2 py-0.5 rounded-full">
                          {(rec as AttendanceRecord & { service_note?: string }).service_note}
                        </span>
                      )}
                    </div>
                    <span className={`text-sm font-bold shrink-0 ${scoreColor(rec.efficiency_score)}`}>
                      {rec.efficiency_score}/100
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-red-400">{rec.total_occupied} occupied</span>
                    <span className="text-amber-400">{rec.total_reserved} reserved</span>
                    <span className="text-zinc-500">{rec.total_seats} total seats</span>
                  </div>
                  {/* Top recommendation */}
                  {rec.efficiency_notes?.[0] && (
                    <p className="text-zinc-500 text-xs border-t border-zinc-700 pt-2 mt-1">{rec.efficiency_notes[0]}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
