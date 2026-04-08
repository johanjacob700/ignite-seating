// Legend — compact pill badges showing the three seat status colours.

export default function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[
        { dot: 'bg-emerald-400', label: 'Available' },
        { dot: 'bg-red-500',     label: 'Taken' },
        { dot: 'bg-amber-400',   label: 'Reserved' },
      ].map(({ dot, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1 text-xs text-zinc-300 font-medium"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          {label}
        </span>
      ))}
    </div>
  )
}
