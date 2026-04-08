'use client'

// ServiceTimer — tracks the Sunday service schedule in Eastern Time.
//
// Shows a live countdown and fires reminders at key moments:
//   10:55am ET  → "Service starts in 5 minutes" banner + browser notification
//   12:55pm ET  → "Submit attendance — service ends in 5 minutes" banner + notification
//    1:00pm ET  → Auto-saves attendance if nothing has been submitted today
//
// In-app banners are the primary reminder mechanism because mobile Safari does
// not support Web Push without a service worker. Browser notifications are
// fired as a bonus on platforms that support them.

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, SectionConfig, Seat } from '@/lib/supabase'
import { analyzeEfficiency, countByStatus } from '@/lib/seating-analysis'

// ── Schedule constants ────────────────────────────────────────────────────────
const START_H = 11   // 11:00am ET
const START_M = 0
const END_H   = 14   //  2:00pm ET
const END_M   = 0
const REMIND_MINS = 5  // fire reminder this many minutes before each event

const toMins = (h: number, m: number) => h * 60 + m
const START_TOTAL  = toMins(START_H, START_M)
const END_TOTAL    = toMins(END_H,   END_M)
const REMIND_START = START_TOTAL - REMIND_MINS  // 10:55am
const REMIND_END   = END_TOTAL   - REMIND_MINS  // 12:55pm

// ── ET time helper ────────────────────────────────────────────────────────────
interface ETTime {
  hours:     number
  minutes:   number
  seconds:   number
  dayOfWeek: number  // 0 = Sunday
  dateStr:   string  // "YYYY-MM-DD"
  totalMins: number  // hours*60 + minutes (for comparisons)
}

function getETTime(): ETTime {
  const now   = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:  'America/New_York',
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
    weekday:   'short',
    hour:      '2-digit',
    minute:    '2-digit',
    second:    '2-digit',
    hour12:    false,
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0'
  const hours     = parseInt(get('hour'))   // 0–23 (Intl uses 24h with hour12:false)
  const minutes   = parseInt(get('minute'))
  const seconds   = parseInt(get('second'))
  const weekday   = get('weekday')
  const dateStr   = `${get('year')}-${get('month')}-${get('day')}`
  const dayOfWeek = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(weekday)

  return { hours, minutes, seconds, dayOfWeek, dateStr, totalMins: hours * 60 + minutes }
}

// ── Service phase ─────────────────────────────────────────────────────────────
type Phase =
  | 'not-sunday'      // any day other than Sunday
  | 'before'          // Sunday, before 10:55am
  | 'remind-start'    // Sunday 10:55–11:00am
  | 'in-progress'     // Sunday 11:00am–12:55pm
  | 'remind-end'      // Sunday 12:55–1:00pm
  | 'ended'           // Sunday after 1:00pm

function getPhase(et: ETTime): Phase {
  if (et.dayOfWeek !== 0) return 'not-sunday'
  const m = et.totalMins
  if (m < REMIND_START) return 'before'
  if (m < START_TOTAL)  return 'remind-start'
  if (m < REMIND_END)   return 'in-progress'
  if (m < END_TOTAL)    return 'remind-end'
  return 'ended'
}

// Format a minute count as "X hr Y min" or "Y min"
function fmtCountdown(mins: number, secs: number): string {
  if (mins <= 0 && secs <= 0) return '0 min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h} hr ${m} min`
  if (h > 0)           return `${h} hr`
  if (m > 0)           return `${m} min ${secs} sec`
  return `${secs} sec`
}

// Fetches seats and checks for an existing record in parallel, then saves.
// Returns false if a record for today already exists.
async function autoSaveAttendance(dateStr: string, layoutMeta: SectionConfig[]): Promise<boolean> {
  const [{ data: existing }, { data: rawSeats }] = await Promise.all([
    supabase.from('attendance').select('id').eq('service_date', dateStr).maybeSingle(),
    supabase.from('seats').select('*'),
  ])
  if (existing || !rawSeats || rawSeats.length === 0) return false

  const seats = rawSeats as Seat[]
  const { occupied, reserved, vacant } = countByStatus(seats)
  const { score, sectionStats, notes } = analyzeEfficiency(seats, layoutMeta)

  await supabase.from('attendance').insert({
    service_date:      dateStr,
    total_occupied:    occupied,
    total_reserved:    reserved,
    total_vacant:      vacant,
    total_seats:       seats.length,
    efficiency_score:  score,
    section_breakdown: sectionStats,
    efficiency_notes:  ['Auto-saved at 2:00pm ET — attendance was not submitted manually.', ...notes],
  })
  return true
}

// ── Browser notification helper ───────────────────────────────────────────────
function sendNotification(title: string, body: string) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' })
  }
}

async function requestNotificationPermission() {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  layoutMeta: SectionConfig[]
}

interface Banner {
  type: 'start' | 'end' | 'auto-saved'
  message: string
}

export default function ServiceTimer({ layoutMeta }: Props) {
  const [et, setEt]               = useState<ETTime>(getETTime)
  const [banner, setBanner]       = useState<Banner | null>(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'skipped'>('idle')

  // Refs to ensure each notification fires exactly once per session
  const firedRemindStart = useRef(false)
  const firedRemindEnd   = useRef(false)
  const firedAutoSave    = useRef(false)

  // Request notification permission once on mount
  useEffect(() => { requestNotificationPermission() }, [])

  // ── Auto-save handler ───────────────────────────────────────────────────────
  const handleAutoSave = useCallback(async (dateStr: string) => {
    if (firedAutoSave.current || layoutMeta.length === 0) return
    firedAutoSave.current = true
    setAutoSaveStatus('saving')

    const saved = await autoSaveAttendance(dateStr, layoutMeta)
    setAutoSaveStatus(saved ? 'saved' : 'skipped')

    if (saved) {
      setBanner({ type: 'auto-saved', message: 'Attendance auto-saved for this Sunday.' })
      sendNotification('Ignite Church', 'Attendance has been auto-saved for today\'s service.')
    }
  }, [layoutMeta])

  // 1-second tick — but only triggers a re-render when the displayed value changes.
  // During reminder windows seconds are shown so every tick matters; during the
  // long "in-progress" window and on non-Sundays only minute-level updates are needed.
  useEffect(() => {
    const tick = setInterval(() => {
      const now   = getETTime()
      const phase = getPhase(now)

      const needsSecondGranularity =
        phase === 'remind-start' ||
        phase === 'remind-end'   ||
        (phase === 'before' && START_TOTAL - now.totalMins <= 1)

      if (needsSecondGranularity || now.seconds === 0) {
        setEt(now)
      }

      if (phase === 'remind-start' && !firedRemindStart.current) {
        firedRemindStart.current = true
        setBanner({ type: 'start', message: 'Service starts in 5 minutes — make sure ushers are ready and seat assignment is active.' })
        sendNotification('Service Starting Soon', 'Ignite Church service starts in 5 minutes. Open the seating chart to begin.')
      }

      if (phase === 'remind-end' && !firedRemindEnd.current) {
        firedRemindEnd.current = true
        setBanner({ type: 'end', message: 'Service ends in 5 minutes — please submit attendance before 2:00pm ET.' })
        sendNotification('Submit Attendance', 'Ignite Church service ends in 5 minutes. Don\'t forget to submit attendance.')
      }

      if (phase === 'ended') {
        handleAutoSave(now.dateStr)
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [handleAutoSave])

  const phase = getPhase(et)

  // ── Countdown calculation ─────────────────────────────────────────────────
  let countdownLabel = ''
  let countdownValue = ''
  let statusColor    = 'text-zinc-400'
  let statusDot      = 'bg-zinc-600'

  if (phase === 'not-sunday') {
    // Find how many days until next Sunday
    const daysUntil = (7 - et.dayOfWeek) % 7 || 7
    countdownLabel = `Next service in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
    countdownValue = 'Sunday 11:00 AM ET'
    statusColor    = 'text-zinc-500'
  } else if (phase === 'before') {
    const targetMins  = START_TOTAL - et.totalMins
    const targetSecs  = 60 - et.seconds
    const adjMins     = targetSecs === 60 ? targetMins : targetMins - 1
    countdownLabel    = 'Service starts in'
    countdownValue    = fmtCountdown(adjMins, targetSecs === 60 ? 0 : targetSecs)
    statusColor       = 'text-zinc-300'
  } else if (phase === 'remind-start') {
    const secsLeft    = (START_TOTAL - et.totalMins) * 60 - et.seconds
    countdownLabel    = '⚠️ Starting soon'
    countdownValue    = `${secsLeft} seconds`
    statusColor       = 'text-amber-400'
    statusDot         = 'bg-amber-400 animate-pulse'
  } else if (phase === 'in-progress') {
    const targetMins  = REMIND_END - et.totalMins
    countdownLabel    = 'Service in progress · ends in'
    countdownValue    = fmtCountdown(targetMins, 60 - et.seconds)
    statusColor       = 'text-emerald-400'
    statusDot         = 'bg-emerald-400 animate-pulse'
  } else if (phase === 'remind-end') {
    const secsLeft    = (END_TOTAL - et.totalMins) * 60 - et.seconds
    countdownLabel    = '⚠️ Submit attendance — ending in'
    countdownValue    = `${secsLeft} seconds`
    statusColor       = 'text-[#BE1E2D]'
    statusDot         = 'bg-[#BE1E2D] animate-pulse'
  } else {
    // ended
    countdownLabel    = 'Service ended'
    countdownValue    = autoSaveStatus === 'saving'  ? 'Auto-saving attendance…'
                      : autoSaveStatus === 'saved'   ? 'Attendance auto-saved ✓'
                      : autoSaveStatus === 'skipped' ? 'Attendance already submitted ✓'
                      : ''
    statusColor       = autoSaveStatus === 'saved' || autoSaveStatus === 'skipped' ? 'text-emerald-400' : 'text-zinc-500'
    statusDot         = 'bg-zinc-600'
  }

  const BANNER_STYLES: Record<Banner['type'], string> = {
    'start':      'bg-amber-500/15 border-amber-500/40 text-amber-300',
    'end':        'bg-[#BE1E2D]/15 border-[#BE1E2D]/40 text-red-300',
    'auto-saved': 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  }
  const bannerStyle = banner ? BANNER_STYLES[banner.type] : ''

  return (
    <div className="space-y-3">
      {/* Timer bar */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          {/* Animated status dot */}
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot}`} />
          <div>
            <p className="text-zinc-500 text-xs">{countdownLabel}</p>
            <p className={`font-bold text-sm ${statusColor}`}>{countdownValue}</p>
          </div>
        </div>
        {/* Current ET time */}
        <div className="text-right shrink-0">
          <p className="text-zinc-600 text-xs">ET now</p>
          <p className="text-zinc-300 text-sm font-mono">
            {String(et.hours % 12 || 12).padStart(2,'0')}:{String(et.minutes).padStart(2,'0')}:{String(et.seconds).padStart(2,'0')} {et.hours < 12 ? 'AM' : 'PM'}
          </p>
        </div>
      </div>

      {/* In-app reminder banner */}
      {banner && (
        <div className={`border rounded-xl px-4 py-3 flex items-start justify-between gap-3 ${bannerStyle}`}>
          <p className="text-sm font-medium leading-snug">{banner.message}</p>
          <button
            onClick={() => setBanner(null)}
            className="text-current opacity-60 hover:opacity-100 text-lg leading-none shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
