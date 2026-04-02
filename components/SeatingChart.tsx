'use client'

// SeatingChart — real-time seating chart for both public and admin views.
//
// Admin select mode — range selection:
//   1. Click "Select seats" to enter select mode
//   2. Click any seat to set it as the ANCHOR (shown with a pulsing white ring)
//   3. Click a second seat to auto-select every seat between anchor and end (in
//      reading order: Section A → B → C, row 1→10, col left→right)
//   4. After a range is set, individual clicks still add/remove single seats
//   5. Use the floating action bar to apply Reserve / Occupied / Vacant to all selected

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, Seat, SeatStatus, SectionConfig } from '@/lib/supabase'
import GroupSuggester from './GroupSuggester'

// Groups sections into render rows matching the saved layout orientation:
//   consecutive vertical sections share a side-by-side row
//   horizontal sections get their own full-width row
type RenderGroup =
  | { type: 'row';  sections: SectionConfig[] }
  | { type: 'full'; section: SectionConfig }

function buildRenderGroups(configs: SectionConfig[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let row: SectionConfig[] = []
  for (const sec of configs) {
    if (sec.orientation === 'horizontal') {
      if (row.length) { groups.push({ type: 'row', sections: row }); row = [] }
      groups.push({ type: 'full', section: sec })
    } else {
      row.push(sec)
    }
  }
  if (row.length) groups.push({ type: 'row', sections: row })
  return groups
}
import SectionChart from './SectionChart'
import Legend from './Legend'

interface SeatingChartProps {
  isAdmin: boolean
  resetTrigger?: number
}

const TOGGLE_CYCLE: Record<SeatStatus, SeatStatus> = {
  vacant:   'occupied',
  occupied: 'vacant',
  reserved: 'vacant',
}

// Canonical reading order: sections alphabetically, then by row, then by column.
// Produces a string key so it works with any section label, not just A/B/C.
function seatSortKey(s: Seat): string {
  return (
    s.section.padEnd(6, '\x00') +
    String(s.row_number).padStart(4, '0') +
    String(s.col_number).padStart(4, '0')
  )
}

export default function SeatingChart({ isAdmin, resetTrigger }: SeatingChartProps) {
  const [seats, setSeats]             = useState<Seat[]>([])
  const [layoutMeta, setLayoutMeta]   = useState<SectionConfig[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId]       = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Group suggestion state ────────────────────────────────────────────────
  // suggestedIds holds seats highlighted purple from the group finder
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set())

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setAnchorId(null)
  }, [])

  // Seats sorted in canonical reading order — used for range calculation
  const sortedSeats = useMemo(() => [...seats].sort((a, b) => seatSortKey(a).localeCompare(seatSortKey(b))), [seats])

  // ── Load seats + layout_meta in parallel ─────────────────────────────────
  // layout_meta row id=1 stores the saved section order and orientations.
  // If it doesn't exist yet (pre-migration), we fall back to deriving section
  // order alphabetically from the seat data — matching the old behaviour.
  const loadSeats = useCallback(async () => {
    const [seatsResult, metaResult] = await Promise.all([
      supabase.from('seats').select('*').order('section').order('row_number').order('col_number'),
      supabase.from('layout_meta').select('config').eq('id', 1).single(),
    ])

    if (seatsResult.error) { setError(seatsResult.error.message) }
    else                   { setSeats(seatsResult.data as Seat[]) }

    if (metaResult.data?.config) {
      setLayoutMeta(metaResult.data.config as SectionConfig[])
    }

    setLoading(false)
  }, [])

  useEffect(() => { loadSeats() }, [loadSeats])

  // ── Real-time subscription ────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('seats-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'seats' }, (payload) => {
        const updated = payload.new as Seat
        setSeats(prev => prev.map(s => (s.id === updated.id ? updated : s)))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Reset trigger ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (resetTrigger === undefined || resetTrigger === 0) return
    const resetAll = async () => {
      const { error } = await supabase
        .from('seats')
        .update({ status: 'vacant' })
        .neq('id', '00000000-0000-0000-0000-000000000000')
      if (!error) {
        setSeats(prev => prev.map(s => ({ ...s, status: 'vacant' })))
        exitSelectMode()
      }
    }
    resetAll()
  }, [resetTrigger, exitSelectMode])

  // ── Single-seat toggle (normal mode) ─────────────────────────────────────
  const handleToggle = useCallback(async (seat: Seat) => {
    const newStatus = TOGGLE_CYCLE[seat.status]
    setSeats(prev => prev.map(s => (s.id === seat.id ? { ...s, status: newStatus } : s)))
    const { error } = await supabase.from('seats').update({ status: newStatus }).eq('id', seat.id)
    if (error) {
      setSeats(prev => prev.map(s => (s.id === seat.id ? { ...s, status: seat.status } : s)))
      console.error('Failed to update seat:', error.message)
    }
  }, [])

  // ── Explicit status set (right-click / long-press context menu) ───────────
  const handleSetStatus = useCallback(async (seat: Seat, status: SeatStatus) => {
    setSeats(prev => prev.map(s => (s.id === seat.id ? { ...s, status } : s)))
    const { error } = await supabase.from('seats').update({ status }).eq('id', seat.id)
    if (error) {
      setSeats(prev => prev.map(s => (s.id === seat.id ? { ...s, status: seat.status } : s)))
      console.error('Failed to set seat status:', error.message)
    }
  }, [])

  // ── Range / multi-select click handler ───────────────────────────────────
  // First click → set anchor and select that single seat.
  // Second click → select all seats between anchor and this seat (inclusive),
  //               replacing the previous selection, then clear the anchor so
  //               the next click starts a fresh range.
  // If user clicks an already-selected seat with no anchor → deselect it.
  const handleSelectToggle = useCallback((seat: Seat) => {
    if (anchorId === null) {
      // No anchor yet — this click becomes the anchor
      setAnchorId(seat.id)
      setSelectedIds(new Set([seat.id]))
    } else if (anchorId === seat.id) {
      // Clicking the anchor again deselects everything and resets
      setAnchorId(null)
      setSelectedIds(new Set())
    } else {
      // Second click — compute range between anchor and this seat
      const anchorIdx = sortedSeats.findIndex(s => s.id === anchorId)
      const endIdx    = sortedSeats.findIndex(s => s.id === seat.id)

      if (anchorIdx === -1 || endIdx === -1) return

      const [from, to] = anchorIdx < endIdx
        ? [anchorIdx, endIdx]
        : [endIdx, anchorIdx]

      // Select every seat in the slice (inclusive both ends)
      const rangeIds = new Set(sortedSeats.slice(from, to + 1).map(s => s.id))
      setSelectedIds(rangeIds)
      // Clear anchor so the next click starts a new range
      setAnchorId(null)
    }
  }, [anchorId, sortedSeats])

  // ── Bulk action ───────────────────────────────────────────────────────────
  const handleBulkAction = useCallback(async (status: SeatStatus) => {
    if (selectedIds.size === 0) return
    setBulkLoading(true)
    const ids = [...selectedIds]
    setSeats(prev => prev.map(s => (ids.includes(s.id) ? { ...s, status } : s)))
    const { error } = await supabase.from('seats').update({ status }).in('id', ids)
    if (error) { console.error('Bulk update failed:', error.message); loadSeats() }
    setBulkLoading(false)
    exitSelectMode()
  }, [selectedIds, loadSeats, exitSelectMode])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalSeats    = seats.length
  const occupiedCount = seats.filter(s => s.status === 'occupied').length
  const vacantCount   = seats.filter(s => s.status === 'vacant').length

  const seatsBySection = (section: string) => seats.filter(s => s.section === section)

  // Build render groups from layout_meta if available, otherwise fall back to
  // deriving section order alphabetically from the seat data (all vertical).
  const renderGroups = useMemo((): RenderGroup[] => {
    if (layoutMeta.length > 0) {
      // Only include sections that actually have seats (guards against stale meta)
      const presentLabels = new Set(seats.map(s => s.section))
      const filtered = layoutMeta.filter(s => presentLabels.has(s.label))
      if (filtered.length > 0) return buildRenderGroups(filtered)
    }
    // Fallback: alphabetical, all vertical
    const labels = [...new Set(sortedSeats.map(s => s.section))]
    return buildRenderGroups(labels.map(label => ({ label, rows: 0, cols: 0, orientation: 'vertical' })))
  }, [layoutMeta, seats, sortedSeats])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-zinc-400 animate-pulse text-lg">Loading seating chart…</div>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-red-400 text-sm">Error: {error}</div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-3">
        <Legend />
        <div className="flex items-center gap-4">
          <div className="flex gap-4 text-sm font-semibold">
            <span className="text-emerald-400">{vacantCount} open</span>
            <span className="text-red-400">{occupiedCount} taken</span>
            <span className="text-zinc-400">{totalSeats} total</span>
          </div>

          {isAdmin && (
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                selectMode
                  ? 'bg-[#BE1E2D] border-[#BE1E2D] text-white'
                  : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:border-zinc-400'
              }`}
            >
              {selectMode
                ? anchorId
                  ? 'Tap end seat…'
                  : selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : 'Tap start seat…'
                : 'Select seats'}
            </button>
          )}
        </div>
      </div>

      {/* Group seating finder — admin only */}
      {isAdmin && (
        <GroupSuggester
          seats={seats}
          layoutMeta={layoutMeta}
          hasSuggestion={suggestedIds.size > 0}
          onSuggest={ids => setSuggestedIds(ids)}
          onDismiss={() => setSuggestedIds(new Set())}
          onAccept={async (ids, status) => {
            setSuggestedIds(new Set())
            const idArr = [...ids]
            setSeats(prev => prev.map(s => idArr.includes(s.id) ? { ...s, status } : s))
            const { error } = await supabase.from('seats').update({ status }).in('id', idArr)
            if (error) { console.error('Group accept failed:', error.message); loadSeats() }
          }}
        />
      )}

      {/* Hint banner shown while in select mode */}
      {isAdmin && selectMode && (
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl px-4 py-2.5 text-blue-300 text-sm">
          {anchorId
            ? '📍 Start seat set — now tap the end seat to select the range.'
            : selectedIds.size > 0
              ? '✓ Range selected. Tap a new seat to start another range, or use the action bar below.'
              : '👆 Tap any seat to set the start of your range.'}
        </div>
      )}

      {/* Seat sections — rendered in orientation-aware groups from layout_meta */}
      {/* Stage label is global — one banner for the whole venue, not per section */}
      <div className="text-center text-zinc-500 text-xs tracking-widest uppercase py-2 border-b border-zinc-800">
        ✦ STAGE / FRONT ✦
      </div>

      <div className="space-y-4">
        {renderGroups.map((group, i) => {
          // Shared props for every SectionChart
          const sectionProps = (label: string) => ({
            seats: seatsBySection(label),
            isAdmin,
            selectMode,
            selectedIds,
            anchorId,
            suggestedIds,
            onToggle:       isAdmin && !selectMode ? handleToggle       : undefined,
            onSetStatus:    isAdmin && !selectMode ? handleSetStatus    : undefined,
            onSelectToggle: isAdmin &&  selectMode ? handleSelectToggle : undefined,
          })

          if (group.type === 'full') {
            // Horizontal section — spans the full width
            return (
              <div key={i} className="w-full overflow-x-auto">
                <SectionChart
                  key={group.section.label}
                  section={group.section.label}
                  {...sectionProps(group.section.label)}
                />
              </div>
            )
          }

          // Vertical sections — side by side, equal columns
          return (
            <div
              key={i}
              className="overflow-x-auto"
            >
              <div
                className="grid gap-6"
                style={{
                  gridTemplateColumns: `repeat(${group.sections.length}, 1fr)`,
                  minWidth: `${group.sections.length * 200}px`,
                }}
              >
                {group.sections.map(sec => (
                  <SectionChart
                    key={sec.label}
                    section={sec.label}
                    {...sectionProps(sec.label)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Back label — global, mirrors the stage label at the top */}
      <div className="text-center text-zinc-500 text-xs tracking-widest uppercase py-2 border-t border-zinc-800">
        ✦ BACK / ENTRANCE ✦
      </div>

      {/* Floating bulk-action bar */}
      {isAdmin && selectMode && selectedIds.size > 0 && !anchorId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-600 rounded-2xl px-5 py-3 shadow-2xl shadow-black/60">
            <span className="text-zinc-300 text-sm font-semibold mr-1">
              {selectedIds.size} seat{selectedIds.size !== 1 ? 's' : ''}
            </span>
            <button disabled={bulkLoading} onClick={() => handleBulkAction('reserved')}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold px-4 py-2 rounded-lg transition-colors">
              Reserve
            </button>
            <button disabled={bulkLoading} onClick={() => handleBulkAction('occupied')}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
              Occupied
            </button>
            <button disabled={bulkLoading} onClick={() => handleBulkAction('vacant')}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
              Vacant
            </button>
            <button onClick={exitSelectMode}
              className="text-zinc-400 hover:text-zinc-200 text-sm px-2 py-2 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
