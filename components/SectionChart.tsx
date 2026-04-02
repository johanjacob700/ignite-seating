'use client'

// SectionChart renders one section of the church (A, B, or C) as a grid of seat buttons.
// Seats are grouped by row, then displayed left-to-right within each row.

import { Seat, SeatStatus } from '@/lib/supabase'
import SeatButton from './SeatButton'

interface SectionChartProps {
  section: string
  seats: Seat[]
  isAdmin: boolean
  selectMode?: boolean
  selectedIds?: Set<string>
  anchorId?: string | null
  suggestedIds?: Set<string>
  onToggle?: (seat: Seat) => void
  onSetStatus?: (seat: Seat, status: SeatStatus) => void
  onSelectToggle?: (seat: Seat) => void
}

export default function SectionChart({
  section, seats, isAdmin,
  selectMode, selectedIds, anchorId, suggestedIds,
  onToggle, onSetStatus, onSelectToggle,
}: SectionChartProps) {
  const rowNumbers = [...new Set(seats.map(s => s.row_number))].sort((a, b) => a - b)

  const total    = seats.length
  const occupied = seats.filter(s => s.status === 'occupied').length
  const vacant   = seats.filter(s => s.status === 'vacant').length

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 sm:p-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide">
          Section {section}
        </h2>
        <div className="flex gap-3 text-xs sm:text-sm">
          <span className="text-emerald-400 font-semibold">{vacant} open</span>
          <span className="text-zinc-500">·</span>
          <span className="text-red-400 font-semibold">{occupied} taken</span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-400">{total} total</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {rowNumbers.map(rowNum => {
          const rowSeats = seats
            .filter(s => s.row_number === rowNum)
            .sort((a, b) => a.col_number - b.col_number)

          return (
            <div key={rowNum} className="flex items-center gap-1.5">
              <span className="text-zinc-500 text-xs w-5 text-right shrink-0">{rowNum}</span>
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
