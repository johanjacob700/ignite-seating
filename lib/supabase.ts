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
