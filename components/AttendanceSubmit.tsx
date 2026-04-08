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
import { supabase, Seat, SectionConfig, AttendanceRecord } from '@/lib/supabase'
import { analyzeEfficiency, countByStatus, EfficiencyResult } from '@/lib/seating-analysis'

const SCORE_COLOR: Record<string, string> = { good: 'text-emerald-400', fair: 'text-amber-400', poor: 'text-red-400' }
const scoreColor = (s: number) => s >= 80 ? SCORE_COLOR.good : s >= 55 ? SCORE_COLOR.fair : SCORE_COLOR.poor
const scoreLabel = (s: number) => s >= 80 ? 'Efficient' : s >= 55 ? 'Fair' : 'Needs Improvement'

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
    const { occupied: totalOccupied, reserved: totalReserved, vacant: totalVacant } = countByStatus(seats)

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
                    {(() => {
                      const { occupied, reserved, vacant } = countByStatus(analysis.seats)
                      return [
                        { label: 'Occupied', value: occupied, color: 'text-red-400' },
                        { label: 'Reserved', value: reserved, color: 'text-amber-400' },
                        { label: 'Vacant',   value: vacant,   color: 'text-emerald-400' },
                      ]
                    })().map(({ label, value, color }) => (
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
                      {rec.service_note && (
                        <span className="inline-block mt-1 bg-[#BE1E2D]/20 text-[#e05060] text-xs font-semibold px-2 py-0.5 rounded-full">
                          {rec.service_note}
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
