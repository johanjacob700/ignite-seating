'use client'

// ThemeToggle — switches between dark (default) and light theme.
// Persists the choice in localStorage and applies/removes the `light` class
// on <html> so the CSS variable overrides in globals.css take effect.

import { useState, useEffect } from 'react'

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState(false)

  // Sync with whatever the anti-flash script applied before hydration
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains('light'))
  }, [])

  const toggle = () => {
    const next = !isLight
    setIsLight(next)
    if (next) {
      document.documentElement.classList.add('light')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.classList.remove('light')
      localStorage.setItem('theme', 'dark')
    }
  }

  return (
    <button
      onClick={toggle}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-base"
    >
      {isLight ? '🌙' : '☀️'}
    </button>
  )
}
