'use client'

// LayoutEditor — lets admins define a custom seating layout.
//
// Features:
//   • Drag-and-drop section cards (via the ≡ handle) to reorder them
//   • Toggle each section between Vertical (column) and Horizontal (full-width row)
//   • Live floor-plan preview showing exactly how sections will be arranged
//   • Apply Layout — wipes seats table and regenerates it, saves config to layout_meta
//   • Save to Favorites / Load / Delete saved layouts

import { useState, useCallback, useRef } from 'react'
import { supabase, SectionConfig, Layout } from '@/lib/supabase'

const DEFAULT_SECTIONS: SectionConfig[] = [
  { label: 'A', rows: 10, cols: 3, orientation: 'vertical' },
  { label: 'B', rows: 10, cols: 5, orientation: 'vertical' },
  { label: 'C', rows: 10, cols: 5, orientation: 'vertical' },
]

interface Props {
  onLayoutApplied: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Groups sections into render rows the same way SeatingChart will display them:
// consecutive vertical sections share a row; horizontal sections get their own full-width row.
type PreviewGroup =
  | { type: 'row';  sections: SectionConfig[] }
  | { type: 'full'; section: SectionConfig }

function buildPreviewGroups(sections: SectionConfig[]): PreviewGroup[] {
  const groups: PreviewGroup[] = []
  let row: SectionConfig[] = []
  for (const sec of sections) {
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

export default function LayoutEditor({ onLayoutApplied }: Props) {
  const [sections, setSections]         = useState<SectionConfig[]>(DEFAULT_SECTIONS)
  const [applying, setApplying]         = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [saveName, setSaveName]         = useState('')
  const [saving, setSaving]             = useState(false)
  const [favorites, setFavorites]       = useState<Layout[]>([])
  const [favLoading, setFavLoading]     = useState(false)
  const [showFav, setShowFav]           = useState(false)
  const [status, setStatus]             = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Draft inputs for rows/cols ────────────────────────────────────────────
  // Stores the raw string the user is currently typing for a given field so we
  // don't snap to the validated integer on every keystroke. Keys are "{idx}-rows"
  // or "{idx}-cols". The draft is committed (validated + clamped) on blur.
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({})

  const getDisplayValue = (idx: number, field: 'rows' | 'cols'): string => {
    const key = `${idx}-${field}`
    return key in rawInputs ? rawInputs[key] : String(sections[idx][field])
  }

  const onNumberChange = (idx: number, field: 'rows' | 'cols', raw: string) => {
    // Allow digits and empty string while the user is mid-edit; store as draft
    if (/^\d*$/.test(raw)) {
      setRawInputs(prev => ({ ...prev, [`${idx}-${field}`]: raw }))
    }
  }

  const onNumberBlur = (idx: number, field: 'rows' | 'cols') => {
    const key = `${idx}-${field}`
    const raw = rawInputs[key] ?? String(sections[idx][field])
    const max = field === 'cols' ? 20 : 30
    const num = Math.max(1, Math.min(max, parseInt(raw) || 1))
    setSections(prev => prev.map((s, i) => i !== idx ? s : { ...s, [field]: num }))
    // Remove the draft so the input reverts to displaying the validated number
    setRawInputs(prev => { const next = { ...prev }; delete next[key]; return next })
  }

  // ── Drag-and-drop state ───────────────────────────────────────────────────
  // dragIdx: the index of the card being dragged
  // overIdx: the index of the card currently being hovered over during drag
  const dragIdx = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const onDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
    // Slight delay so the browser renders the ghost before we change opacity
    setTimeout(() => setOverIdx(idx), 0)
  }

  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overIdx !== idx) setOverIdx(idx)
  }

  const onDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    const from = dragIdx.current
    if (from === null || from === idx) { dragIdx.current = null; setOverIdx(null); return }
    const updated = [...sections]
    const [moved] = updated.splice(from, 1)
    updated.splice(idx, 0, moved)
    setSections(updated)
    dragIdx.current = null
    setOverIdx(null)
  }

  const onDragEnd = () => {
    dragIdx.current = null
    setOverIdx(null)
  }

  // ── Section field updates ─────────────────────────────────────────────────

  const updateSection = (idx: number, field: keyof SectionConfig, raw: string) => {
    setSections(prev => prev.map((s, i) => {
      if (i !== idx) return s
      if (field === 'label') return { ...s, label: raw.toUpperCase().slice(0, 6) }
      if (field === 'orientation') return { ...s, orientation: raw as SectionConfig['orientation'] }
      const num = Math.max(1, Math.min(field === 'cols' ? 20 : 30, parseInt(raw) || 1))
      return { ...s, [field]: num }
    }))
  }

  const toggleOrientation = (idx: number) => {
    setSections(prev => prev.map((s, i) =>
      i !== idx ? s : { ...s, orientation: s.orientation === 'horizontal' ? 'vertical' : 'horizontal' }
    ))
  }

  const addSection = () => {
    const used = new Set(sections.map(s => s.label))
    let label = ''
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i)
      if (!used.has(c)) { label = c; break }
    }
    if (!label) label = String(sections.length + 1)
    setSections(prev => [...prev, { label, rows: 10, cols: 5, orientation: 'vertical' }])
  }

  const removeSection = (idx: number) => {
    setSections(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Apply layout ──────────────────────────────────────────────────────────

  const applyLayout = useCallback(async () => {
    setApplying(true)
    setStatus(null)
    setConfirmApply(false)

    // Step 1: delete all existing seats
    const { error: delErr } = await supabase
      .from('seats')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (delErr) {
      setStatus({ ok: false, msg: `Could not clear seats: ${delErr.message}` })
      setApplying(false)
      return
    }

    // Step 2: insert new seat rows from the current section config
    const newSeats = sections.flatMap(sec =>
      Array.from({ length: sec.rows }, (_, r) =>
        Array.from({ length: sec.cols }, (_, c) => ({
          section:    sec.label,
          row_number: r + 1,
          col_number: c + 1,
          label:      `${sec.label}-${r + 1}-${c + 1}`,
          status:     'vacant',
        }))
      ).flat()
    )

    const { error: insErr } = await supabase.from('seats').insert(newSeats)
    if (insErr) {
      setStatus({ ok: false, msg: `Could not create seats: ${insErr.message}` })
      setApplying(false)
      return
    }

    // Step 3: persist the section config (including order + orientation) to layout_meta
    // so SeatingChart and the public view can render sections correctly
    const { error: metaErr } = await supabase
      .from('layout_meta')
      .upsert({ id: 1, config: sections })

    if (metaErr) {
      // Non-fatal — seats were created, just orientation may not persist
      console.error('Failed to save layout_meta:', metaErr.message)
    }

    setStatus({ ok: true, msg: `Layout applied — ${newSeats.length} seats across ${sections.length} sections.` })
    setApplying(false)
    onLayoutApplied()
  }, [sections, onLayoutApplied])

  // ── Favorites ─────────────────────────────────────────────────────────────

  const loadFavorites = useCallback(async () => {
    setFavLoading(true)
    const { data, error } = await supabase
      .from('layouts')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setFavorites(data as Layout[])
    setFavLoading(false)
  }, [])

  const toggleFavorites = () => {
    if (!showFav) loadFavorites()
    setShowFav(v => !v)
  }

  const saveAsFavorite = useCallback(async () => {
    if (!saveName.trim()) return
    setSaving(true)
    const { error } = await supabase.from('layouts').insert({ name: saveName.trim(), config: sections })
    if (error) {
      setStatus({ ok: false, msg: `Save failed: ${error.message}` })
    } else {
      setStatus({ ok: true, msg: `"${saveName.trim()}" saved to favorites.` })
      setSaveName('')
      if (showFav) loadFavorites()
    }
    setSaving(false)
  }, [saveName, sections, showFav, loadFavorites])

  const loadFavorite = (layout: Layout) => {
    // Ensure every section has an orientation field (backwards compat with older saves)
    const config = layout.config.map(s => ({ ...s, orientation: s.orientation ?? 'vertical' }))
    setSections(config)
    setShowFav(false)
    setStatus({ ok: true, msg: `"${layout.name}" loaded. Click Apply when ready.` })
  }

  const deleteFavorite = async (id: string) => {
    await supabase.from('layouts').delete().eq('id', id)
    loadFavorites()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalSeats    = sections.reduce((n, s) => n + s.rows * s.cols, 0)
  const previewGroups = buildPreviewGroups(sections)

  return (
    <div className="space-y-8 max-w-3xl">

      {/* Status banner */}
      {status && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          status.ok
            ? 'bg-emerald-900/40 border border-emerald-700/60 text-emerald-300'
            : 'bg-red-900/40 border border-red-700/60 text-red-300'
        }`}>
          {status.msg}
        </div>
      )}

      {/* ── Section builder ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-zinc-300 text-sm font-semibold uppercase tracking-widest">Sections</h3>
          <span className="text-zinc-500 text-xs">Drag ≡ to reorder</span>
        </div>

        {sections.map((sec, idx) => {
          const isBeingDragged = dragIdx.current === idx
          const isDropTarget   = overIdx === idx && dragIdx.current !== null && dragIdx.current !== idx

          return (
            <div
              key={idx}
              onDragOver={e => onDragOver(e, idx)}
              onDrop={e => onDrop(e, idx)}
              className={`
                relative bg-zinc-900 border rounded-xl p-4 transition-all duration-150
                ${isBeingDragged  ? 'opacity-40 border-zinc-600' : 'border-zinc-700'}
                ${isDropTarget    ? 'border-blue-500 shadow-lg shadow-blue-900/30' : ''}
              `}
            >
              {/* Drop indicator line */}
              {isDropTarget && (
                <div className="absolute -top-px left-4 right-4 h-0.5 bg-blue-500 rounded-full" />
              )}

              <div className="flex flex-wrap items-center gap-3">

                {/* Drag handle */}
                <div
                  draggable
                  onDragStart={e => onDragStart(e, idx)}
                  onDragEnd={onDragEnd}
                  className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 select-none px-1 text-lg transition-colors"
                  title="Drag to reorder"
                >
                  ≡
                </div>

                {/* Section name */}
                <div className="flex items-center gap-1.5">
                  <label className="text-zinc-500 text-xs">Name</label>
                  <input
                    type="text"
                    value={sec.label}
                    onChange={e => updateSection(idx, 'label', e.target.value)}
                    className="w-14 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-white text-sm font-bold text-center focus:outline-none focus:border-[#BE1E2D] transition-colors"
                  />
                </div>

                {/* Rows */}
                <div className="flex items-center gap-1.5">
                  <label className="text-zinc-500 text-xs">Rows</label>
                  <input
                    type="text" inputMode="numeric"
                    value={getDisplayValue(idx, 'rows')}
                    onChange={e => onNumberChange(idx, 'rows', e.target.value)}
                    onBlur={() => onNumberBlur(idx, 'rows')}
                    className="w-14 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-[#BE1E2D] transition-colors"
                  />
                </div>

                {/* Cols */}
                <div className="flex items-center gap-1.5">
                  <label className="text-zinc-500 text-xs">Cols</label>
                  <input
                    type="text" inputMode="numeric"
                    value={getDisplayValue(idx, 'cols')}
                    onChange={e => onNumberChange(idx, 'cols', e.target.value)}
                    onBlur={() => onNumberBlur(idx, 'cols')}
                    className="w-14 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-[#BE1E2D] transition-colors"
                  />
                </div>

                {/* Orientation toggle */}
                <button
                  onClick={() => toggleOrientation(idx)}
                  title={sec.orientation === 'horizontal'
                    ? 'Horizontal — spans full width. Click to switch to vertical column.'
                    : 'Vertical — column alongside others. Click to switch to horizontal full-width.'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    sec.orientation === 'horizontal'
                      ? 'bg-blue-900/40 border-blue-600 text-blue-300'
                      : 'bg-zinc-800 border-zinc-600 text-zinc-400 hover:border-zinc-400'
                  }`}
                >
                  {sec.orientation === 'horizontal' ? '↔ Horizontal' : '↕ Vertical'}
                </button>

                {/* Mini dot preview */}
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: Math.min(sec.rows, 5) }).map((_, r) => (
                    <div key={r} className="flex gap-0.5">
                      {Array.from({ length: Math.min(sec.cols, 8) }).map((_, c) => (
                        <div key={c} className={`w-1.5 h-1.5 rounded-sm ${
                          sec.orientation === 'horizontal' ? 'bg-blue-500/50' : 'bg-emerald-500/50'
                        }`} />
                      ))}
                      {sec.cols > 8 && <span className="text-zinc-700 text-xs">+{sec.cols - 8}</span>}
                    </div>
                  ))}
                  {sec.rows > 5 && <div className="text-zinc-700 text-xs">+{sec.rows - 5} rows</div>}
                </div>

                {/* Seat count + remove */}
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-zinc-500 text-xs">{sec.rows * sec.cols} seats</span>
                  {sections.length > 1 && (
                    <button
                      onClick={() => removeSection(idx)}
                      className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={addSection}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + Add Section
          </button>
          <span className="text-zinc-500 text-sm">
            {sections.length} section{sections.length !== 1 ? 's' : ''} ·{' '}
            <span className="text-white font-semibold">{totalSeats}</span> total seats
          </span>
        </div>
      </div>

      {/* ── Floor plan preview ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-zinc-300 text-sm font-semibold uppercase tracking-widest mb-3">
          Layout Preview
        </h3>
        <div className="bg-zinc-950 border border-zinc-700 rounded-xl p-4 space-y-2">
          {/* Single stage indicator for the whole layout */}
          <div className="text-center text-zinc-600 text-xs tracking-widest uppercase pb-1 border-b border-zinc-800">
            ✦ STAGE / FRONT ✦
          </div>

          {previewGroups.map((group, i) =>
            group.type === 'full' ? (
              // Horizontal section — full width
              <div
                key={i}
                className="w-full bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-3 flex items-center justify-between"
              >
                <span className="text-blue-300 text-sm font-bold">{group.section.label}</span>
                <span className="text-blue-400/60 text-xs">
                  {group.section.rows} rows × {group.section.cols} cols · {group.section.rows * group.section.cols} seats · full width
                </span>
              </div>
            ) : (
              // Row of vertical sections side by side
              <div
                key={i}
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${group.sections.length}, 1fr)` }}
              >
                {group.sections.map(sec => (
                  <div
                    key={sec.label}
                    className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-3 text-center"
                  >
                    <div className="text-white text-sm font-bold">{sec.label}</div>
                    <div className="text-zinc-500 text-xs mt-0.5">
                      {sec.rows}r × {sec.cols}c
                    </div>
                    <div className="text-zinc-600 text-xs">{sec.rows * sec.cols} seats</div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Single back indicator for the whole layout */}
          <div className="text-center text-zinc-600 text-xs tracking-widest uppercase pt-1 border-t border-zinc-800">
            ✦ BACK / ENTRANCE ✦
          </div>
        </div>
      </div>

      {/* ── Apply + Save row ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-zinc-800">
        <button
          onClick={() => setConfirmApply(true)}
          disabled={applying || sections.length === 0}
          className="bg-[#BE1E2D] hover:bg-[#9e1826] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-lg transition-colors"
        >
          {applying ? 'Applying…' : 'Apply Layout'}
        </button>

        <div className="flex gap-2 flex-1 min-w-0">
          <input
            type="text"
            placeholder="Name this layout to save…"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveAsFavorite()}
            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-400 transition-colors"
          />
          <button
            onClick={saveAsFavorite}
            disabled={saving || !saveName.trim()}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {saving ? 'Saving…' : '★ Save'}
          </button>
        </div>
      </div>

      {/* ── Saved favorites ──────────────────────────────────────────────── */}
      <div>
        <button
          onClick={toggleFavorites}
          className="text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
        >
          {showFav ? '▲ Hide saved layouts' : '▼ Show saved layouts'}
        </button>

        {showFav && (
          <div className="mt-3 space-y-2">
            {favLoading && <p className="text-zinc-500 text-sm">Loading…</p>}
            {!favLoading && favorites.length === 0 && (
              <p className="text-zinc-600 text-sm">No saved layouts yet.</p>
            )}
            {favorites.map(layout => {
              const seatCount = layout.config.reduce((n, s) => n + s.rows * s.cols, 0)
              return (
                <div key={layout.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3">
                  <div>
                    <span className="text-white text-sm font-semibold">{layout.name}</span>
                    <span className="text-zinc-500 text-xs ml-3">
                      {layout.config.length} section{layout.config.length !== 1 ? 's' : ''} · {seatCount} seats
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {layout.config.map((s, i) => (
                        <span key={i} className={`text-xs rounded px-1.5 py-0.5 ${
                          s.orientation === 'horizontal'
                            ? 'bg-blue-900/40 text-blue-400'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {s.label}: {s.rows}×{s.cols}
                          {s.orientation === 'horizontal' ? ' ↔' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => loadFavorite(layout)}
                      className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteFavorite(layout.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors px-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Apply confirmation modal ──────────────────────────────────────── */}
      {confirmApply && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full space-y-4 text-center">
            <h2 className="text-white text-xl font-bold">Apply this layout?</h2>
            <p className="text-zinc-400 text-sm">
              This will <span className="text-red-400 font-semibold">delete all current seats</span> and
              replace them with {totalSeats} new seats across {sections.length} section{sections.length !== 1 ? 's' : ''}.
              Current occupancy data will be lost.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmApply(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyLayout}
                className="flex-1 bg-[#BE1E2D] hover:bg-[#9e1826] text-white font-bold py-2.5 rounded-lg transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
