'use client'

// AttendanceSubmit — lets ushers record attendance at the end of each service.
//
// What gets saved per record:
//   • service_date, service_note
//   • total_occupied / total_reserved / total_vacant / total_seats
//   • seat_snapshot — full seat state at time of save, used to render a visual
//     seating map in the history view so ushers can see exactly how the room
//     was arranged on any given Sunday.

import { useState } from 'react'
import { supabase, Seat, SectionConfig, AttendanceRecord, SnapshotSeat } from '@/lib/supabase'
import { countByStatus } from '@/lib/seating-analysis'

interface Props {
  layoutMeta: SectionConfig[]
}

// Build a compact snapshot from the live seat array — strip fields we don't need for display
function buildSnapshot(seats: Seat[]): SnapshotSeat[] {
  return seats.map(s => ({ section: s.section, row: s.row_number, col: s.col_number, status: s.status }))
}

// ── Snapshot mini-chart ────────────────────────────────────────────────────────
// Renders a dot-grid for each section so ushers can visually scan the seating
// pattern: red = occupied, amber = reserved, dark = vacant.
function SnapshotGrid({ snapshot, layoutMeta }: { snapshot: SnapshotSeat[], layoutMeta: SectionConfig[] }) {
  // Respect saved layout order if available; otherwise fall back to alphabetical
  const sectionLabels = layoutMeta.length > 0
    ? layoutMeta.map(s => s.label).filter(l => snapshot.some(s => s.section === l))
    : [...new Set(snapshot.map(s => s.section))].sort()

  return (
    <div className="flex flex-wrap gap-4 pt-1">
      {sectionLabels.map(label => {
        const secSeats = snapshot.filter(s => s.section === label)
        const rows = [...new Set(secSeats.map(s => s.row))].sort((a, b) => a - b)

        return (
          <div key={label}>
            <p className="text-zinc-600 text-[10px] font-semibold uppercase mb-1">Sec {label}</p>
            <div className="space-y-0.5">
              {rows.map(row => {
                const cols = secSeats
                  .filter(s => s.row === row)
                  .sort((a, b) => a.col - b.col)
                return (
                  <div key={row} className="flex gap-0.5">
                    {cols.map(seat => (
                      <div
                        key={`${seat.row}-${seat.col}`}
                        title={`${label}-${seat.row}-${seat.col}: ${seat.status}`}
                        className={`w-2.5 h-2.5 rounded-sm ${
                          seat.status === 'occupied' ? 'bg-red-500' :
                          seat.status === 'reserved' ? 'bg-amber-400' :
                          'bg-zinc-700'
                        }`}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AttendanceSubmit({ layoutMeta }: Props) {
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]         = useState<AttendanceRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedId, setExpandedId]   = useState<number | null>(null)
  const [serviceNote, setServiceNote] = useState('')

  // Data prepared when the modal opens — snapshot + counts
  const [pending, setPending] = useState<{
    seats: Seat[]
    snapshot: SnapshotSeat[]
    serviceDate: string
  } | null>(null)

  // Open submit modal: fetch latest seats
  const handleOpen = async () => {
    setLoading(true)
    setOpen(true)
    setSaved(false)
    setServiceNote('')

    const { data } = await supabase.from('seats').select('*')
    if (!data) { setLoading(false); return }

    const seats = data as Seat[]
    const today = new Date().toISOString().split('T')[0]
    setPending({ seats, snapshot: buildSnapshot(seats), serviceDate: today })
    setLoading(false)
  }

  // Save attendance record
  const handleSave = async () => {
    if (!pending) return
    setSaving(true)

    const { seats, snapshot, serviceDate } = pending
    const { occupied, reserved, vacant } = countByStatus(seats)

    await supabase.from('attendance').insert({
      service_date:   serviceDate,
      total_occupied: occupied,
      total_reserved: reserved,
      total_vacant:   vacant,
      total_seats:    seats.length,
      service_note:   serviceNote.trim() || null,
      seat_snapshot:  snapshot,
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
                <p className="text-zinc-400 text-sm text-center py-6">Loading seat data…</p>
              )}

              {!loading && pending && !saved && (
                <>
                  {/* Date */}
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-sm">Service date</span>
                    <input
                      type="date"
                      value={pending.serviceDate}
                      onChange={e => setPending({ ...pending, serviceDate: e.target.value })}
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
                  {(() => {
                    const { occupied, reserved, vacant } = countByStatus(pending.seats)
                    const total = pending.seats.length
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: 'Occupied', value: occupied, color: 'text-red-400' },
                            { label: 'Reserved', value: reserved, color: 'text-amber-400' },
                            { label: 'Vacant',   value: vacant,   color: 'text-emerald-400' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="bg-zinc-800 rounded-xl p-3 text-center">
                              <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
                              <div className="text-zinc-500 text-xs mt-0.5">{label}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-zinc-500 text-xs text-center">
                          {occupied + reserved} of {total} seats in use · {Math.round((occupied + reserved) / Math.max(total, 1) * 100)}% full
                        </p>
                      </div>
                    )
                  })()}

                  {/* Snapshot preview — shows exactly what will be stored */}
                  <div className="space-y-2">
                    <p className="text-zinc-400 text-xs uppercase tracking-wide font-semibold">Seating snapshot</p>
                    <div className="bg-zinc-800 rounded-xl p-4 overflow-x-auto">
                      <SnapshotGrid snapshot={pending.snapshot} layoutMeta={layoutMeta} />
                      <div className="flex gap-3 mt-3 pt-3 border-t border-zinc-700">
                        {[
                          { dot: 'bg-red-500',    label: 'Occupied' },
                          { dot: 'bg-amber-400',  label: 'Reserved' },
                          { dot: 'bg-zinc-700',   label: 'Vacant' },
                        ].map(({ dot, label }) => (
                          <span key={label} className="flex items-center gap-1.5 text-zinc-500 text-xs">
                            <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${dot}`} />
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
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
                    Record stored for {pending?.serviceDate}
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
                <p className="text-zinc-500 text-sm text-center py-6">
                  No records yet. Submit attendance after a service to start tracking.
                </p>
              )}

              {!historyLoading && history.map(rec => {
                const isExpanded = expandedId === rec.id
                const inUse = rec.total_occupied + rec.total_reserved
                const fillPct = Math.round(inUse / Math.max(rec.total_seats, 1) * 100)

                return (
                  <div key={rec.id} className="bg-zinc-800 rounded-xl overflow-hidden">
                    {/* Summary row */}
                    <div className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-white font-semibold text-sm block">
                            {new Date(rec.service_date + 'T12:00:00').toLocaleDateString('en-US', {
                              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                            })}
                          </span>
                          {rec.service_note && (
                            <span className="inline-block mt-1 bg-[#BE1E2D]/20 text-[#e05060] text-xs font-semibold px-2 py-0.5 rounded-full">
                              {rec.service_note}
                            </span>
                          )}
                        </div>
                        {/* Occupancy % pill */}
                        <span className="shrink-0 bg-zinc-700 text-zinc-200 text-xs font-bold px-2.5 py-1 rounded-full">
                          {fillPct}% full
                        </span>
                      </div>

                      {/* Seat counts */}
                      <div className="flex gap-4 text-xs">
                        <span className="text-red-400">{rec.total_occupied} occupied</span>
                        <span className="text-amber-400">{rec.total_reserved} reserved</span>
                        <span className="text-zinc-500">{rec.total_vacant} vacant</span>
                        <span className="text-zinc-600">{rec.total_seats} total</span>
                      </div>

                      {/* Expand/collapse snapshot button */}
                      {rec.seat_snapshot && rec.seat_snapshot.length > 0 && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          {isExpanded ? '▲ Hide seating map' : '▼ View seating snapshot'}
                        </button>
                      )}
                    </div>

                    {/* Expanded snapshot */}
                    {isExpanded && rec.seat_snapshot && (
                      <div className="px-4 pb-4 border-t border-zinc-700/60">
                        <div className="pt-3 overflow-x-auto">
                          <SnapshotGrid snapshot={rec.seat_snapshot} layoutMeta={layoutMeta} />
                        </div>
                        <div className="flex gap-3 mt-3 pt-2 border-t border-zinc-700/40">
                          {[
                            { dot: 'bg-red-500',   label: 'Occupied' },
                            { dot: 'bg-amber-400', label: 'Reserved' },
                            { dot: 'bg-zinc-600',  label: 'Vacant' },
                          ].map(({ dot, label }) => (
                            <span key={label} className="flex items-center gap-1.5 text-zinc-600 text-xs">
                              <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${dot}`} />
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
