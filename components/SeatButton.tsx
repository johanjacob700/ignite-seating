'use client'

// SeatButton renders a single seat tile.
// In admin normal mode:
//   - Left-click cycles: vacant → occupied → vacant
//   - Right-click (desktop) or long-press (mobile) opens a context menu for explicit status
// In admin select mode:
//   - Click toggles the seat in/out of the multi-selection (shows a blue highlight ring)
//   - Right-click / long-press is disabled (use the bulk action bar instead)
// In public mode: read-only, no interaction.

import { Seat, SeatStatus } from '@/lib/supabase'
import { useRef, useState } from 'react'

interface SeatButtonProps {
  seat: Seat
  isAdmin: boolean
  selectMode?: boolean
  isSelected?: boolean
  isAnchor?: boolean
  isSuggested?: boolean   // true when this seat is part of a group suggestion
  onToggle?: (seat: Seat) => void
  onSetStatus?: (seat: Seat, status: SeatStatus) => void
  onSelectToggle?: (seat: Seat) => void
}

const STATUS_STYLES: Record<SeatStatus, string> = {
  vacant:   'bg-emerald-500 border-emerald-400 hover:bg-emerald-400 text-white',
  occupied: 'bg-red-600   border-red-500   hover:bg-red-500   text-white',
  reserved: 'bg-amber-500 border-amber-400 hover:bg-amber-400 text-black',
}

const STATUS_STYLES_READONLY: Record<SeatStatus, string> = {
  vacant:   'bg-emerald-500 border-emerald-400 text-white',
  occupied: 'bg-red-600   border-red-500   text-white',
  reserved: 'bg-amber-500 border-amber-400 text-black',
}

const ALL_STATUSES: { status: SeatStatus; label: string; style: string }[] = [
  { status: 'vacant',   label: 'Vacant',   style: 'text-emerald-400 hover:bg-zinc-700' },
  { status: 'occupied', label: 'Occupied', style: 'text-red-400 hover:bg-zinc-700' },
  { status: 'reserved', label: 'Reserved', style: 'text-amber-400 hover:bg-zinc-700' },
]

const LONG_PRESS_MS = 500

export default function SeatButton({
  seat, isAdmin, selectMode, isSelected, isAnchor, isSuggested,
  onToggle, onSetStatus, onSelectToggle,
}: SeatButtonProps) {
  const shortLabel = `${seat.row_number}-${seat.col_number}`
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick  = useRef(false)

  const openMenu  = (x: number, y: number) => setMenu({ x, y })
  const closeMenu = () => setMenu(null)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // Context menu is disabled in select mode — use the floating action bar instead
    if (selectMode) return
    openMenu(e.clientX, e.clientY)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (selectMode) return
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      suppressClick.current = true
      openMenu(touch.clientX, touch.clientY)
    }, LONG_PRESS_MS)
  }

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (selectMode) {
      // In select mode, clicks add/remove from selection
      onSelectToggle?.(seat)
    } else {
      onToggle?.(seat)
    }
  }

  // ── Public (read-only) view ───────────────────────────────────────────────
  if (!isAdmin) {
    const styles = STATUS_STYLES_READONLY[seat.status]
    return (
      <div
        title={`${seat.label} — ${seat.status}`}
        className={`w-10 h-10 rounded border text-xs font-bold flex items-center justify-center ${styles}`}
      >
        {shortLabel}
      </div>
    )
  }

  // ── Admin view ────────────────────────────────────────────────────────────
  // When selected, override the normal status colour with a blue selection ring
  const baseStyles = STATUS_STYLES[seat.status]
  // Suggestion gets a purple ring; anchor gets a pulsing white ring; selected gets blue
  const selectedOverlay = isSuggested
    ? 'ring-2 ring-offset-1 ring-offset-zinc-900 ring-purple-400 scale-110 z-10'
    : isAnchor
      ? 'ring-2 ring-offset-1 ring-offset-zinc-900 ring-white animate-pulse scale-110 z-10'
      : isSelected
        ? 'ring-2 ring-offset-1 ring-offset-zinc-900 ring-blue-400 scale-110 z-10'
        : ''

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        title={
          selectMode
            ? `${seat.label} — click to ${isSelected ? 'deselect' : 'select'}`
            : `${seat.label} — ${seat.status} (right-click for options)`
        }
        className={`
          relative w-10 h-10
          rounded border text-xs font-bold
          transition-all duration-150 cursor-pointer
          ${baseStyles} ${selectedOverlay}
        `}
      >
        {shortLabel}
      </button>

      {/* Context menu (normal mode only) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div
            className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[130px]"
            style={{ top: menu.y, left: menu.x }}
          >
            <div className="px-3 py-1.5 text-zinc-500 text-xs border-b border-zinc-700 mb-1">
              {seat.label}
            </div>
            {ALL_STATUSES.map(({ status, label, style }) => (
              <button
                key={status}
                onClick={() => { closeMenu(); onSetStatus?.(seat, status) }}
                disabled={seat.status === status}
                className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${style} ${seat.status === status ? 'opacity-40 cursor-default' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
