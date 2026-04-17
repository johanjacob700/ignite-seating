# Ignite Church Seating — CLAUDE.md

Reference file for AI-assisted development. Read this instead of re-reading source
files. Update this file whenever significant changes are made.

---

## Tech Stack

- **Next.js 15** (App Router, `'use client'` components throughout)
- **TypeScript**, **Tailwind CSS v4** (utility classes, no config file — uses CSS variables)
- **Supabase** — Postgres + Realtime (free tier: 2 concurrent Realtime connections max)
- **Deployed on Vercel** — auto-deploys on push to `main` on GitHub (`johanjacob700/ignite-seating`)

### Environment Variables (set in Vercel + local `.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_ADMIN_PASSWORD=          # default: ignite2024
```

---

## File Map

```
app/
  layout.tsx          Root layout — anti-flash theme script, global CSS import
  globals.css         Tailwind base + light-theme CSS variable overrides (html.light)
  page.tsx            Public seating view (read-only, live-updating, no login)
  admin/page.tsx      Usher admin view (password-gated)

components/
  SeatingChart.tsx    Core chart — loads seats + layout_meta, real-time sub, renders sections
  SectionChart.tsx    One section card — progress bar, seat grid, optional purple highlight ring
  SeatButton.tsx      Single seat — renders vacant/occupied/reserved states, handles clicks
  GroupSuggester.tsx  Group seating finder — best-fit algorithm, suggests N seats
  Legend.tsx          Pill badges — Available / Taken / Reserved
  AttendanceSubmit.tsx  Submit + history modal for weekly attendance records
  ServiceTimer.tsx    Countdown timer, 10:55am/1:55pm reminders, 2pm auto-save
  ThemeToggle.tsx     Light/dark toggle — writes html.light class + localStorage
  LayoutEditor.tsx    Section builder — saved favorites, applies layout to Supabase

lib/
  supabase.ts         Supabase client + all TypeScript types (Seat, SectionConfig, etc.)
  seating-analysis.ts countByStatus(), calcSectionStats(), analyzeEfficiency()
```

---

## Database Schema (Supabase)

### `seats`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| section | text | e.g. 'A', 'B', 'LEFT' |
| row_number | int | |
| col_number | int | |
| label | text | e.g. "A-3-2" |
| status | text | `'vacant'` \| `'occupied'` \| `'reserved'` |
| updated_at | timestamptz | |

### `layout_meta`
| column | type | notes |
|---|---|---|
| id | int | always row id=1 |
| config | jsonb | `SectionConfig[]` — section order + orientations |

### `layouts`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | user-supplied label |
| config | jsonb | `SectionConfig[]` |
| created_at | timestamptz | |

### `attendance`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| service_date | date | ISO e.g. "2026-04-06" |
| total_occupied | int | |
| total_reserved | int | |
| total_vacant | int | |
| total_seats | int | |
| efficiency_score | int | 0–100 |
| section_breakdown | jsonb | `SectionStat[]` |
| efficiency_notes | jsonb | `string[]` |
| service_note | text | nullable — e.g. "Easter Sunday" |
| created_at | timestamptz | |

---

## Key TypeScript Types (`lib/supabase.ts`)

```ts
type SeatStatus = 'vacant' | 'occupied' | 'reserved'

interface Seat          { id, section, row_number, col_number, label, status, updated_at }
interface SectionConfig { label, rows, cols, orientation?: 'vertical' | 'horizontal' }
interface Layout        { id, name, config: SectionConfig[], created_at }
interface SectionStat   { label, total, occupied, reserved, vacant, rate }  // rate = 0–1
interface AttendanceRecord { id, service_date, total_occupied, total_reserved,
                             total_vacant, total_seats, efficiency_score,
                             section_breakdown, efficiency_notes, service_note, created_at }
```

---

## Component Interfaces (props)

### `SeatingChart`
```ts
{ isAdmin: boolean, resetTrigger?: number, onLayoutLoaded?: (meta: SectionConfig[]) => void }
```
- Loads seats + layout_meta in parallel on mount
- Manages: suggestedIds (purple highlight), selectMode (range selection), anchorId
- Subscribes to Supabase Realtime for live seat updates (admin only — to stay under 2-connection limit)
- Passes `id="section-{label}"` on each section wrapper + `isHighlighted` to SectionChart
- Scrolls to first suggested section via `scrollIntoView` when suggestedIds change

### `SectionChart`
```ts
{ section, seats, isAdmin, isHighlighted?, selectMode?, selectedIds?, anchorId?,
  suggestedIds?, onToggle?, onSetStatus?, onSelectToggle? }
```
- `isHighlighted=true` → purple border ring (group finder drew attention here)
- Shows occupancy progress bar in the header

### `GroupSuggester`
```ts
{ seats, layoutMeta, hasSuggestion, onSuggest, onAccept, onDismiss }
```
- Algorithm: best-fit → same row same section → multi-row same section → cross-section last resort
- No-singles rule: prefers splits with ≥2 per row; falls back to 1-seat row rather than crossing sections

### `ServiceTimer`
```ts
{ layoutMeta: SectionConfig[] }
```
- Schedule: service 11am–2pm ET on Sundays
- Reminders fire once per session at 10:55am (start) and 1:55pm (end)
- Auto-save fires at 2pm ET if no attendance record exists for today

### `AttendanceSubmit`
```ts
{ layoutMeta: SectionConfig[] }
```
- Submit modal: fresh seat fetch + `analyzeEfficiency()` + service note + save to `attendance`
- History modal: last 20 records ordered by date desc

---

## Styling Conventions

- **Brand red**: `#BE1E2D` (hover: `#9e1826`)
- **Background dark**: `zinc-950`, cards: `zinc-900`, borders: `zinc-800` / `zinc-700`
- **Status colours**: `emerald-400` = vacant/open, `red-500` = occupied/taken, `amber-400` = reserved
- **Suggestion highlight**: `purple-500` (seats) + `purple-500/70` border (section card)
- **Light theme**: toggled by `html.light` class → CSS variable overrides in `globals.css`
  - ThemeToggle writes `localStorage.setItem('theme', 'light'|'dark')` and flips the class
  - Anti-flash script in `app/layout.tsx` applies the class before first paint
- **Mobile layout**: bottom nav bar (fixed, `sm:hidden`) for Seating / Reset / Layout tabs
  - Desktop uses tab bar inside sticky header (`hidden sm:flex`)
  - Bottom padding `pb-28` on main to avoid content hiding behind the nav bar
- **Seat buttons**: uniform `w-10 h-10` (no responsive variants)
- **Section scroll**: `overflow-x-auto` container with fixed-pixel widths (`52 + cols * 46`) — keeps sections side-by-side on mobile without stacking

---

## Common Patterns

### Fetching seats
```ts
const { data } = await supabase.from('seats').select('*')
const seats = data as Seat[]
```

### Updating a seat
```ts
await supabase.from('seats').update({ status: newStatus }).eq('id', seat.id)
```

### Parallel fetches
```ts
const [seatsRes, metaRes] = await Promise.all([
  supabase.from('seats').select('*'),
  supabase.from('layout_meta').select('config').eq('id', 1).single(),
])
```

### Efficiency analysis
```ts
import { countByStatus, analyzeEfficiency } from '@/lib/seating-analysis'
const { occupied, reserved, vacant } = countByStatus(seats)
const { score, sectionStats, notes } = analyzeEfficiency(seats, layoutMeta)
```

### Deploy
```bash
git add <files> && git commit -m "..." && git push
# Vercel auto-deploys from main — no manual trigger needed
```

---

## Architecture Notes

- **Realtime**: only admin subscribes to Supabase Realtime (`SeatingChart` with `isAdmin=true`).
  The public page polls/re-renders via the same channel but Supabase free tier allows unlimited
  read-only listeners; the 2-connection limit applies to channels created by the client.
- **Layout meta**: `layout_meta` id=1 is the single source of truth for section order and
  orientation. If absent, SeatingChart falls back to alphabetical order (all vertical).
- **Width formula**: section card pixel width = `52 + cols * 46`
  (16px padding × 2 + 20px row-label + seat cols × 40px + gaps)
- **Theme**: all existing components automatically flip when `html.light` is set because
  Tailwind v4 CSS variables (`--color-zinc-*`) are overridden — no per-component changes needed.
- **Admin password**: stored in `NEXT_PUBLIC_ADMIN_PASSWORD` env var. Client-side only check
  (appropriate for a church usher tool, not a security-critical system).
