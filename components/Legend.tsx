// Legend shows the color key for seat statuses at the top of the page.

export default function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-emerald-500 border border-emerald-400" />
        <span className="text-zinc-300">Vacant</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-red-600 border border-red-500" />
        <span className="text-zinc-300">Occupied</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-amber-500 border border-amber-400" />
        <span className="text-zinc-300">Reserved</span>
      </div>
    </div>
  )
}
