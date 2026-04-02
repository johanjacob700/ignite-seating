'use client'

// GroupSuggester — finds the best available seats for a group of N people.
//
// Core principle: BEST-FIT seat allocation.
//   Before recommending any block of seats, scan ALL consecutive vacant blocks in the
//   entire layout and score them by how much "waste" using them would create:
//
//     waste = block.length - groupSize   (0 = perfect fit, higher = wasteful)
//
//   Blocks are ranked: lowest waste first → then closest to stage.
//
//   This ensures isolated seats (block size 1) are filled before breaking up larger
//   continuous runs that could seat future groups. For example, given:
//     Section A row 2: [occupied, VACANT, vacant]   → block of 2 (waste=1 for group of 1)
//     Section B row 2: [vacant, vacant, vacant, occupied, VACANT] → block of 1 (waste=0)
//   For a group of 1, the isolated seat in B is recommended first — the A block of 2
//   is preserved for a potential future group of 2.
//
//   Strategies (applied in order after best-fit scoring):
//   1. Best-fit block within the same section + row (seats sit together)
//   2. Best-fit across same physical depth row (same stage distance, spans sections)
//   3. Front-fill fallback (when group can't fit in any single row)

import { useState } from 'react'
import { Seat, SeatStatus, SectionConfig } from '@/lib/supabase'

interface Suggestion {
  ids: string[]
  description: string
  strategy: 'together' | 'spill' | 'last-resort'
}

interface Props {
  seats: Seat[]
  layoutMeta: SectionConfig[]
  onSuggest:  (ids: Set<string>) => void
  onAccept:   (ids: Set<string>, status: SeatStatus) => void
  onDismiss:  () => void
  hasSuggestion: boolean
}

// ── Algorithm helpers ─────────────────────────────────────────────────────────

// Derive a physical depth map from layoutMeta, respecting orientation groups.
// Sections that are side-by-side (vertical) share the same group depth index.
// A horizontal section gets its own depth index based on where it sits in the layout.
//
// Example: [A(V), B(V), C(V), D(H)] → A,B,C all get groupDepth=0, D gets groupDepth=1
// Example: [D(H), A(V), B(V)]       → D gets groupDepth=0, A,B get groupDepth=1
//
// This means a horizontal section at the bottom of the layout always sorts AFTER
// vertical sections above it, regardless of row numbers within each section.
function buildDepthMap(layoutMeta: SectionConfig[]): {
  groupDepth: Map<string, number>   // section label → physical group index
  secIdxInGroup: Map<string, number> // section label → left-to-right order within group
} {
  const groupDepth    = new Map<string, number>()
  const secIdxInGroup = new Map<string, number>()

  let depth = 0
  let i = 0
  while (i < layoutMeta.length) {
    const sec = layoutMeta[i]
    if (sec.orientation === 'horizontal') {
      // Horizontal section — its own depth slot
      groupDepth.set(sec.label, depth)
      secIdxInGroup.set(sec.label, 0)
      depth++
      i++
    } else {
      // Collect all consecutive vertical sections into one depth slot
      let j = i
      while (j < layoutMeta.length && layoutMeta[j].orientation !== 'horizontal') {
        groupDepth.set(layoutMeta[j].label, depth)
        secIdxInGroup.set(layoutMeta[j].label, j - i)
        j++
      }
      depth++
      i = j
    }
  }
  return { groupDepth, secIdxInGroup }
}

// Find runs of seats where each seat's col_number is exactly 1 more than the previous.
function consecutiveBlocks(rowSeats: Seat[]): Seat[][] {
  const blocks: Seat[][] = []
  let cur: Seat[] = []
  for (let i = 0; i < rowSeats.length; i++) {
    if (i === 0 || rowSeats[i].col_number === rowSeats[i - 1].col_number + 1) {
      cur.push(rowSeats[i])
    } else {
      if (cur.length) blocks.push(cur)
      cur = [rowSeats[i]]
    }
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

// A scored candidate block ready for comparison
interface ScoredBlock {
  seats: Seat[]
  waste: number    // block.length - groupSize; lower is better (0 = perfect fit)
  orphan: boolean  // true when using this block would leave exactly 1 seat behind
  depth: number    // physical stage distance of this block
  row:   number    // row number within the block's section
}

function findBestSeats(
  seats: Seat[],
  layoutMeta: SectionConfig[],
  groupSize: number,
): Suggestion | null {
  const vacant = seats.filter(s => s.status === 'vacant')
  if (vacant.length < groupSize) return null

  const { groupDepth, secIdxInGroup } = buildDepthMap(layoutMeta)
  const gd = (s: Seat) => groupDepth.get(s.section)    ?? 999
  const si = (s: Seat) => secIdxInGroup.get(s.section) ?? 999

  // Section column counts — used to waive the orphan penalty when groupSize is
  // exactly one less than the section width, because in that case leaving 1 seat
  // behind is unavoidable and the group can never be placed without doing so.
  const sectionCols = new Map(layoutMeta.map(s => [s.label, s.cols]))

  // Master sort: physical depth → row → section left-to-right → column
  const sorted = [...vacant].sort((a, b) => {
    const d = gd(a) - gd(b); if (d !== 0) return d
    const r = a.row_number - b.row_number; if (r !== 0) return r
    const s = si(a) - si(b); if (s !== 0) return s
    return a.col_number - b.col_number
  })

  // ── Strategy 1: same section, same row, consecutive seats ───────────────────
  // Only consider blocks within a single section and single row.
  // Groups are NEVER split across sections at this stage.
  const candidates: ScoredBlock[] = []

  const bySecRow = new Map<string, Seat[]>()
  for (const seat of sorted) {
    const key = `${seat.section}__${seat.row_number}`
    if (!bySecRow.has(key)) bySecRow.set(key, [])
    bySecRow.get(key)!.push(seat)
  }

  for (const rowSeats of bySecRow.values()) {
    for (const block of consecutiveBlocks(rowSeats)) {
      if (block.length >= groupSize) {
        const waste = block.length - groupSize
        const secWidth = sectionCols.get(block[0].section) ?? 0
        // Orphan rule: penalise blocks that leave exactly 1 seat behind —
        // UNLESS the group size is one less than the full section width,
        // in which case a single leftover is unavoidable and must be allowed.
        const orphan = waste === 1 && groupSize !== secWidth - 1
        candidates.push({
          seats: block,
          waste,
          orphan,
          depth: gd(block[0]),
          row:   block[0].row_number,
        })
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.orphan !== b.orphan) return a.orphan ? 1 : -1
    if (a.depth  !== b.depth)  return a.depth - b.depth
    if (a.row    !== b.row)    return a.row   - b.row
    return a.waste - b.waste
  })

  if (candidates.length > 0) {
    const best   = candidates[0]
    const picked = best.seats.slice(0, groupSize)
    const sec    = picked[0].section
    const row    = picked[0].row_number
    return {
      ids: picked.map(s => s.id),
      description: `Row ${row} · Section ${sec} · seats ${picked[0].col_number}–${picked[groupSize - 1].col_number}`,
      strategy: 'together',
    }
  }

  // ── Multi-row spill: same section, consecutive rows, no singles ─────────────
  // Reached when no single-row block fits the whole group.
  //
  // Rules:
  //   1. Stay within one section, fill front rows first.
  //   2. Each row slice must contain ≥ 2 seats — never leave anyone alone in a row.
  //      e.g. group of 6, section 5 cols → 4+2 or 3+3, never 5+1.
  //   3. To achieve this, when the last row would receive only 1 seat, we pull
  //      one seat back from the previous row so the final row gets at least 2.

  const bySec = new Map<string, Seat[]>()
  for (const seat of sorted) {
    if (!bySec.has(seat.section)) bySec.set(seat.section, [])
    bySec.get(seat.section)!.push(seat)
  }

  interface SpillResult {
    ids: string[]
    description: string
    depth: number
    startRow: number
    hasSingle: boolean  // true when the last row receives only 1 seat — less ideal but valid
  }
  const spillResults: SpillResult[] = []

  for (const [section, secSeats] of bySec.entries()) {
    const rows = [...new Set(secSeats.map(s => s.row_number))].sort((a, b) => a - b)

    // Track the best result found for this section — we prefer a "clean" split
    // (no row gets only 1 person) but will fall back to a single-row if that's
    // the only way to seat the group within this one section.
    let cleanResult: SpillResult | null = null
    let singleResult: SpillResult | null = null

    for (let i = 0; i < rows.length; i++) {
      // Collect the best consecutive block from each consecutive row, front first.
      // rowSlices[k] = the seats we'd take from rows[i+k].
      const rowSlices: Seat[][] = []
      let totalCollected = 0

      for (let j = i; j < rows.length && totalCollected < groupSize; j++) {
        const rowSeats = secSeats
          .filter(s => s.row_number === rows[j])
          .sort((a, b) => a.col_number - b.col_number)

        const blocks = consecutiveBlocks(rowSeats)
        if (blocks.length === 0) continue

        // Take the largest consecutive block in this row
        const best = blocks.reduce((a, b) => b.length > a.length ? b : a)
        rowSlices.push(best)
        totalCollected += best.length
      }

      if (totalCollected < groupSize) continue // this section can't fit the group

      // Trim slices to exactly groupSize seats, front rows first.
      const trimmed: Seat[][] = []
      let remaining = groupSize
      for (const slice of rowSlices) {
        if (remaining <= 0) break
        trimmed.push(slice.slice(0, remaining))
        remaining -= trimmed[trimmed.length - 1].length
      }

      // ── No-single rule ────────────────────────────────────────────────────
      // If the last row ends up with only 1 seat, try to rebalance by moving
      // one seat from the previous row (only possible when prev has ≥ 3 seats).
      // If rebalancing isn't possible, we still keep this as a "single" candidate
      // rather than rejecting it outright — it's better than crossing sections.
      let hasSingle = false
      if (trimmed.length >= 2) {
        const last = trimmed[trimmed.length - 1]
        const prev = trimmed[trimmed.length - 2]
        if (last.length === 1) {
          if (prev.length >= 3) {
            // Rebalance: move one seat from the end of prev into last
            const moved = prev.splice(prev.length - 1, 1)
            trimmed[trimmed.length - 1] = [...moved, ...last]
          } else {
            // Can't rebalance, but still record as a "has-single" fallback
            hasSingle = true
          }
        }
      }

      const allPicked = trimmed.flat()
      if (allPicked.length < groupSize) continue

      const uniqueRows = [...new Set(allPicked.map(s => s.row_number))]
      const rowLabel = uniqueRows.length === 1
        ? `Row ${uniqueRows[0]}`
        : `Rows ${uniqueRows[0]}–${uniqueRows[uniqueRows.length - 1]}`
      const splitLabel = trimmed.map(r => r.length).join('+')

      const result: SpillResult = {
        ids: allPicked.map(s => s.id),
        description: `${rowLabel} · Section ${section} (${splitLabel} split)`,
        depth: gd(secSeats[0]),
        startRow: rows[i],
        hasSingle,
      }

      // Keep the earliest clean result; fall back to earliest single result
      if (!hasSingle && !cleanResult) {
        cleanResult = result
        break // Found a clean split starting from the earliest row — stop here
      } else if (hasSingle && !singleResult) {
        singleResult = result
        // Don't break — keep looking for a clean split in later rows
      }
    }

    // Prefer clean result for this section; fall back to single result
    const bestForSection = cleanResult ?? singleResult
    if (bestForSection) spillResults.push(bestForSection)
  }

  if (spillResults.length > 0) {
    // Rank: clean splits (hasSingle=false) before single splits, then by depth, then by start row
    spillResults.sort((a, b) => {
      if (a.hasSingle !== b.hasSingle) return a.hasSingle ? 1 : -1
      if (a.depth !== b.depth) return a.depth - b.depth
      return a.startRow - b.startRow
    })
    const best = spillResults[0]
    return { ids: best.ids, description: best.description, strategy: 'spill' }
  }

  // ── Last resort: cross-section ────────────────────────────────────────────
  // The group genuinely cannot fit within any single section across any number
  // of rows (e.g. total vacant in every section < groupSize).
  // Only now do we cross section boundaries, staying as close to the stage as possible.
  const picked = sorted.slice(0, groupSize)
  const rows   = [...new Set(picked.map(s => s.row_number))]
  const secs   = [...new Set(picked.map(s => s.section))].join(', ')
  const rowStr = rows.length === 1 ? `Row ${rows[0]}` : `Rows ${rows[0]}–${rows[rows.length - 1]}`
  return { ids: picked.map(s => s.id), description: `${rowStr} · Sections ${secs}`, strategy: 'last-resort' }
}

// ── Component ─────────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<Suggestion['strategy'], string> = {
  'together':    'Seats together in one row',
  'spill':       'Group spans two rows in the same section',
  'last-resort': 'Best available — group is too large to fit in one section',
}

const STRATEGY_COLORS: Record<Suggestion['strategy'], string> = {
  'together':    'text-emerald-400',
  'spill':       'text-amber-400',
  'last-resort': 'text-red-400',
}

export default function GroupSuggester({
  seats, layoutMeta, onSuggest, onAccept, onDismiss, hasSuggestion,
}: Props) {
  const [groupSize, setGroupSize]       = useState<number>(5)
  const [suggestion, setSuggestion]     = useState<Suggestion | null>(null)
  const [notFound, setNotFound]         = useState(false)
  // On mobile the panel starts collapsed to save screen space; expands on tap
  const [expanded, setExpanded]         = useState(false)

  const vacantCount = seats.filter(s => s.status === 'vacant').length

  const handleFind = () => {
    setNotFound(false)
    const result = findBestSeats(seats, layoutMeta, groupSize)
    if (result) {
      setSuggestion(result)
      onSuggest(new Set(result.ids))
    } else {
      setSuggestion(null)
      onSuggest(new Set())
      setNotFound(true)
    }
  }

  const handleAccept = (status: SeatStatus) => {
    if (!suggestion) return
    onAccept(new Set(suggestion.ids), status)
    setSuggestion(null)
  }

  const handleDismiss = () => {
    setSuggestion(null)
    setNotFound(false)
    setExpanded(false)
    onDismiss()
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
      {/* Header row — always visible, acts as toggle on mobile */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 sm:cursor-default"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-white text-sm font-semibold">Group Seating Finder</h3>
          {/* Show active suggestion badge when collapsed on mobile */}
          {hasSuggestion && !expanded && (
            <span className="bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">Active</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs hidden sm:inline">{vacantCount} vacant</span>
          {/* Chevron — only visible on mobile */}
          <span className="text-zinc-400 text-sm sm:hidden">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Collapsible body — always open on sm+, toggled on mobile */}
      <div className={`${expanded ? 'block' : 'hidden'} sm:block px-5 pb-4 space-y-4`}>
        <div className="text-zinc-500 text-xs sm:hidden mb-1">{vacantCount} vacant seats available</div>

        {/* Input row — number stepper + Find button side by side on mobile */}
        <div className="flex items-center gap-3">
          <label className="text-zinc-400 text-sm shrink-0">Group size</label>
          {/* Stepper for easy tap-based increment/decrement on mobile */}
          <div className="flex items-center bg-zinc-800 border border-zinc-600 rounded-lg overflow-hidden">
            <button
              onClick={() => { setSuggestion(null); onDismiss(); setNotFound(false); setGroupSize(n => Math.max(1, n - 1)) }}
              className="px-3 py-2 text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors active:bg-zinc-600"
            >−</button>
            <span className="px-3 text-white text-sm font-semibold min-w-[2rem] text-center">{groupSize}</span>
            <button
              onClick={() => { setSuggestion(null); onDismiss(); setNotFound(false); setGroupSize(n => Math.min(vacantCount, n + 1)) }}
              className="px-3 py-2 text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors active:bg-zinc-600"
            >+</button>
          </div>
          <button
            onClick={handleFind}
            className="bg-[#BE1E2D] hover:bg-[#9e1826] text-white text-sm font-bold px-5 py-2 rounded-lg transition-colors flex-1 sm:flex-none"
          >
            Find Seats
          </button>
          {hasSuggestion && (
            <button
              onClick={handleDismiss}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Not enough seats */}
        {notFound && (
          <div className="text-amber-400 text-sm">
            Not enough vacant seats for a group of {groupSize}. Only {vacantCount} available.
          </div>
        )}

        {/* Suggestion result */}
        {suggestion && (
          <div className="bg-zinc-800 border border-indigo-700/50 rounded-xl px-4 py-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* Strategy badge */}
                <span className={`text-xs font-semibold uppercase tracking-wide ${STRATEGY_COLORS[suggestion.strategy]}`}>
                  {STRATEGY_LABELS[suggestion.strategy]}
                </span>
                {/* Location */}
                <p className="text-white font-bold text-base mt-0.5">{suggestion.description}</p>
                <p className="text-zinc-400 text-sm mt-0.5">
                  {suggestion.ids.length} seat{suggestion.ids.length !== 1 ? 's' : ''} · highlighted in purple on the chart
                </p>
              </div>
            </div>

            {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => handleAccept('reserved')}
              className="bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold px-4 py-2 rounded-lg transition-colors"
            >
              Reserve for Group
            </button>
            <button
              onClick={() => handleAccept('occupied')}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
            >
              Mark Occupied
            </button>
            <button
              onClick={handleDismiss}
              className="bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
