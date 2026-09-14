import { useState, useEffect, useRef, useCallback } from 'react'

import {
  KLIPY_TABS,
  type KlipyTab,
  type KlipyItem,
  klipyTrendingUrl,
  klipySearchUrl,
  previewUrl,
  shareUrl,
  hasVideo,
  parseResults
} from '@shared/klipy'

type ContentTab = KlipyTab
const TABS = KLIPY_TABS

interface GifPickerProps {
  onSelect: (url: string) => void
  onClose: () => void
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [activeTab, setActiveTab] = useState<ContentTab>('gifs')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KlipyItem[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevTab = useRef<ContentTab>(activeTab)

  // Close on outside click / escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClick)
    })
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // Fetch when tab changes or on mount
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      setResults([])
      prevTab.current = activeTab
    }
    if (query.trim()) {
      fetchSearch(activeTab, query)
    } else {
      fetchTrending(activeTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const fetchTrending = async (tab: ContentTab) => {
    try {
      setLoading(true)
      const res = await fetch(klipyTrendingUrl(tab))
      if (!res.ok) return
      const json = await res.json()
      setResults(parseResults(json))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const fetchSearch = async (tab: ContentTab, q: string) => {
    if (!q.trim()) {
      fetchTrending(tab)
      return
    }
    try {
      setLoading(true)
      const res = await fetch(klipySearchUrl(tab, q))
      if (!res.ok) return
      const json = await res.json()
      setResults(parseResults(json))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }


  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      if (value.trim()) {
        fetchSearch(activeTab, value)
      } else {
        fetchTrending(activeTab)
      }
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full right-0 z-30 mb-2 w-96 rounded-lg bg-gray-900 shadow-xl ring-1 ring-gray-700"
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-700 px-2 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="border-b border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2 rounded bg-gray-900 px-3 py-1.5">
          <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={`Search ${TABS.find((t) => t.id === activeTab)?.label || ''}`}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); fetchTrending(activeTab) }}
              className="text-gray-500 hover:text-gray-300"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results grid */}
      <div className="max-h-80 overflow-y-auto p-2">
        {loading && results.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Loading...
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            No results found
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {results.map((item, i) => (
            <button
              key={item.slug || i}
              onClick={() => {
                onSelect(shareUrl(item))
                onClose()
              }}
              className="group relative overflow-hidden rounded-md hover:ring-2 hover:ring-indigo-500"
              title={item.title}
            >
              {hasVideo(item) ? (
                <video
                  src={previewUrl(item)}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="h-28 w-full object-cover"
                />
              ) : (
                <img
                  src={previewUrl(item)}
                  alt={item.title}
                  loading="lazy"
                  className="h-28 w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              {/* Title overlay on hover */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-[10px] leading-tight text-white line-clamp-1">{item.title}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-700 px-3 py-1 text-center text-[10px] text-gray-600">
        Powered by Klipy
      </div>
    </div>
  )
}
