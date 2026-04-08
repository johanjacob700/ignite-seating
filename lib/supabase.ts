// Supabase client setup using the new publishable key format.
// This client is used both client-side and server-side throughout the app.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

// Single shared client instance — safe to use in browser with Row Level Security
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    // Enable real-time multiplexing for low-latency seat updates
    params: { eventsPerSecond: 10 },
  },
})

// TypeScript types mirroring the Supabase `seats` table schema
export type SeatStatus = 'vacant' | 'occupied' | 'reserved'

export interface Seat {
  id: string          // UUID primary key
  section: string     // any label e.g. 'A', 'LEFT', 'BALCONY'
  row_number: number
  col_number: number
  label: string       // e.g. "A-3-2"
  status: SeatStatus
  updated_at: string
}

// One section inside a saved layout config
export interface SectionConfig {
  label: string                              // section name displayed on the chart
  rows: number
  cols: number
  // vertical (default): section rendered as a column alongside others
  // horizontal: section spans the full width of the chart (e.g. a balcony)
  orientation?: 'vertical' | 'horizontal'
}

// A saved layout record from the `layouts` table
export interface Layout {
  id: string
  name: string
  config: SectionConfig[]
  created_at: string
}

// Per-section stats stored inside an attendance record
export interface SectionStat {
  label: string
  total: number
  occupied: number
  reserved: number
  vacant: number
  rate: number   // 0–1 occupancy fraction
}

// One Sunday's attendance record from the `attendance` table
export interface AttendanceRecord {
  id: number
  service_date: string          // ISO date e.g. "2026-04-06"
  total_occupied: number        // seats marked occupied
  total_reserved: number        // seats marked reserved
  total_vacant: number
  total_seats: number
  efficiency_score: number      // 0–100
  section_breakdown: SectionStat[]
  efficiency_notes: string[]    // human-readable recommendations
  service_note: string | null   // optional usher note e.g. "Easter Sunday"
  created_at: string
}
