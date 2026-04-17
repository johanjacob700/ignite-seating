'use client'

// SectionChart renders one section of the church (A, B, or C) as a grid of seat buttons.
// Seats are grouped by row, then displayed left-to-right within each row.
// The header shows an occupancy progress bar so ushers can see fill rate at a glance.

import { Seat, SeatStatus } from '@/lib/supabase'
import SeatButton from './SeatButton'

interface SectionChartProps {
  section: string
  seats: Seat[]
  isAdmin: boolean
  isHighlighted?: boolean  // true when this section contains group-finder suggested seats
  selectMode?: boolean
  selectedIds?: Set<string>
  anchorId?: string | null
  suggestedIds?: Set<string>
  onToggle?: (seat: Seat) => void
  onSetStatus?: (seat: Seat, status: SeatStatus) => void
  onSelectToggle?: (seat: Seat) => void
}

export default function SectionChart({
  section, seats, isAdmin, isHighlighted,
  selectMode, selectedIds, anchorId, suggestedIds,
  onToggle, onSetStatus, onSelectToggle,
}: SectionChartProps) {
  const rowNumbers = [...new Set(seats.map(s => s.row_number))].sort((a, b) => a - b)

  const total    = seats.length
  const occupied = seats.filter(s => s.status === 'occupied').length
  const reserved = seats.filter(s => s.status === 'reserved').length
  const vacant   = seats.filter(s => s.status === 'vacant').length
  const taken    = occupied + reserved
  const fillPct  = total > 0 ? Math.round((taken / total) * 100) : 0

  // A purple ring on the card border draws the eye to the recommended section
  // after the group finder scrolls it into view on mobile.
  const cardClass = isHighlighted
    ? 'bg-zinc-900 border-2 border-purple-500/70 rounded-2xl overflow-hidden shadow-lg shadow-purple-900/30'
    : 'bg-zinc-900 border border-zinc-700/60 rounded-2xl overflow-hidden'

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          {/* Section badge + name */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#BE1E2D] flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-black">{section}</span>
            </div>
            <span className="text-white font-bold text-sm tracking-wide">Section {section}</span>
          </div>

          {/* Counts */}
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <span className="text-emerald-400 font-bold">{vacant}</span>
            <span className="text-zinc-600">open</span>
            <span className="text-zinc-700 mx-0.5">·</span>
            <span className="text-zinc-400">{total} seats</span>
          </div>
        </div>

        {/* Occupancy progress bar */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#BE1E2D] rounded-full transition-all duration-500"
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <span className="text-zinc-500 text-xs w-8 text-right shrink-0">{fillPct}%</span>
        </div>
      </div>

      {/* Seat grid */}
      <div className="px-4 py-3 flex flex-col gap-1.5">
        {rowNumbers.map(rowNum => {
          const rowSeats = seats
            .filter(s => s.row_number === rowNum)
            .sort((a, b) => a.col_number - b.col_number)

          return (
            <div key={rowNum} className="flex items-center gap-1.5">
              <span className="text-zinc-600 text-xs w-5 text-right shrink-0">{rowNum}</span>
              <div className="flex gap-1.5">
                {rowSeats.map(seat => (
                  <SeatButton
                    key={seat.id}
                    seat={seat}
                    isAdmin={isAdmin}
                    selectMode={selectMode}
                    isSelected={selectedIds?.has(seat.id) ?? false}
                    isAnchor={anchorId === seat.id}
                    isSuggested={suggestedIds?.has(seat.id) ?? false}
                    onToggle={onToggle}
                    onSetStatus={onSetStatus}
                    onSelectToggle={onSelectToggle}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
