// Shared seating analysis utilities used by AttendanceSubmit and ServiceTimer.

import { Seat, SectionConfig, SectionStat } from './supabase'

// Count seats by status in a single pass.
export function countByStatus(seats: Seat[]) {
  let occupied = 0, reserved = 0, vacant = 0
  for (const s of seats) {
    if      (s.status === 'occupied') occupied++
    else if (s.status === 'reserved') reserved++
    else                              vacant++
  }
  return { occupied, reserved, vacant }
}

// Per-section occupancy stats used in attendance records and efficiency reports.
export function calcSectionStats(seats: Seat[], layoutMeta: SectionConfig[]): SectionStat[] {
  return layoutMeta.map(sec => {
    const s = seats.filter(x => x.section === sec.label)
    const { occupied, reserved, vacant } = countByStatus(s)
    return {
      label: sec.label,
      total: s.length,
      occupied,
      reserved,
      vacant,
      rate: (occupied + reserved) / Math.max(s.length, 1),
    }
  })
}

export interface EfficiencyResult {
  score: number
  sectionStats: SectionStat[]
  notes: string[]
}

// Analyse a completed seating pattern and return a 0–100 score with
// human-readable recommendations for the usher team.
export function analyzeEfficiency(seats: Seat[], layoutMeta: SectionConfig[]): EfficiencyResult {
  const notes: string[] = []
  let score = 100

  const sectionStats = calcSectionStats(seats, layoutMeta)

  // Front-fill check: vacant rows that sit before the last occupied row mean
  // people skipped rows instead of filling front-to-back.
  for (const sec of layoutMeta) {
    const secSeats    = seats.filter(s => s.section === sec.label)
    const occupiedRows = secSeats.filter(s => s.status !== 'vacant').map(s => s.row_number)
    if (occupiedRows.length === 0) continue

    const maxOccupiedRow = Math.max(...occupiedRows)
    const skippedRows = [...new Set(
      secSeats
        .filter(s => s.status === 'vacant' && s.row_number < maxOccupiedRow)
        .map(s => s.row_number)
    )].sort((a, b) => a - b)

    if (skippedRows.length > 0) {
      notes.push(
        `Section ${sec.label}: rows ${skippedRows.join(', ')} have empty seats while later rows are used — seat people front-to-back next time.`
      )
      score -= Math.min(20, skippedRows.length * 5)
    }
  }

  // Isolated single vacant seats: trapped between occupied neighbours in the
  // same row — they can no longer be comfortably offered to anyone.
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
        if (sorted[i].status === 'vacant' &&
            sorted[i - 1].status !== 'vacant' &&
            sorted[i + 1].status !== 'vacant') {
          isolatedCount++
        }
      }
    }
  }
  if (isolatedCount > 0) {
    notes.push(
      `${isolatedCount} isolated seat${isolatedCount > 1 ? 's' : ''} ended up trapped between occupied seats — they can't be used. Try to keep vacant seats in groups.`
    )
    score -= Math.min(15, isolatedCount * 3)
  }

  // Section imbalance: one section significantly more full than another.
  const rates   = sectionStats.map(s => s.rate)
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

  // Low overall occupancy.
  const totalUsed = seats.filter(s => s.status !== 'vacant').length
  if (totalUsed / Math.max(seats.length, 1) < 0.3) {
    notes.push(
      `Only ${Math.round(totalUsed / seats.length * 100)}% of seats were used. Consider consolidating seating to fewer sections to keep the energy concentrated near the front.`
    )
    score -= 10
  }

  if (notes.length === 0) {
    notes.push('Great job! Seating was efficient — people filled from the front and no seats were wasted.')
  }

  return { score: Math.max(0, Math.min(100, score)), sectionStats, notes }
}
