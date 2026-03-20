import { useState, useEffect, useRef, useCallback } from 'react'

const API_KEY = '1xQDx9n6q39fXn2j7FbcqMfkyMycbdhu2TuekgY2olcinbjC5lhty6JV7ue1mK0l'
const API_BASE = `https://api.klipy.com/api/v1/${API_KEY}`

type ContentTab = 'gifs' | 'stickers' | 'clips' | 'static-memes' | 'emojis'

const TABS: { id: ContentTab; label: string }[] = [
  { id: 'gifs', label: 'GIFs' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'clips', label: 'Clips' },
  { id: 'static-memes', label: 'Memes' },
  { id: 'emojis', label: 'Emoji' },
]

/** File format entry from Klipy API */
interface FileFormat {
  url: string
  width: number
  height: number
  size: number
}

/** Size variant containing multiple formats */
interface SizeVariant {
  gif?: FileFormat
  webp?: FileFormat
  mp4?: FileFormat
  webm?: FileFormat
  jpg?: FileFormat
  png?: FileFormat
}

/** Klipy API item — clips use flat file URLs, other types use nested size variants */
interface KlipyItem {
  url: string
  title: string
  slug: string
  file: {
    hd?: SizeVariant
    md?: SizeVariant
    sm?: SizeVariant
    xs?: SizeVariant
    // Flat format used by clips
    mp4?: string
    gif?: string
    webp?: string
    png?: string
    jpg?: string
  }
}

interface GifPickerProps {
  onSelect: (url: string) => void
  onClose: () => void
}

/** Check if the file object uses flat format (clips) vs nested size variants */
function isFlat(file: KlipyItem['file']): boolean {
  return typeof file.mp4 === 'string' || typeof file.gif === 'string' || typeof file.webp === 'string'
}

/** Get the best preview URL (small animated format for thumbnails) */
function getPreviewUrl(item: KlipyItem): string {
  const f = item.file
  if (!f) return item.url
  // Flat format (clips): prefer webp/gif for preview, fall back to mp4
  if (isFlat(f)) {
    return (f.webp as string) || (f.gif as string) || (f.mp4 as string) || item.url
  }
  // Nested format: prefer sm/md size in webp/gif
  const variant = f.sm || f.md || f.hd || f.xs
  if (!variant) return item.url
  return variant.webp?.url || variant.gif?.url || variant.png?.url || variant.mp4?.url || item.url
}

/** Get the best share URL (HD animated) */
function getShareUrl(item: KlipyItem): string {
  const f = item.file
  if (!f) return item.url
  // Flat format (clips): prefer gif/mp4 for sharing
  if (isFlat(f)) {
    return (f.gif as string) || (f.mp4 as string) || (f.webp as string) || item.url
  }
  // Nested format: prefer hd size
  const variant = f.hd || f.md || f.sm
  if (!variant) return item.url
  return variant.gif?.url || variant.webp?.url || variant.mp4?.url || variant.png?.url || item.url
}

/** Check if item has video (mp4) as its primary format */
function hasVideo(item: KlipyItem): boolean {
  const f = item.file
  if (!f) return false
  // Flat format: video if mp4 exists and no gif/webp/png
  if (isFlat(f)) {
    return !!(f.mp4 && !f.gif && !f.webp && !f.png)
  }
  // Nested format
  const variant = f.sm || f.md || f.hd
  return !!(variant?.mp4?.url && !variant?.gif?.url && !variant?.webp?.url && !variant?.png?.url)
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
      const res = await fetch(`${API_BASE}/${tab}/trending?per_page=20`)
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
      const res = await fetch(
        `${API_BASE}/${tab}/search?q=${encodeURIComponent(q)}&per_page=20`
      )
      if (!res.ok) return
      const json = await res.json()
      setResults(parseResults(json))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const parseResults = (json: Record<string, unknown>): KlipyItem[] => {
    const data = json.data
    if (Array.isArray(data)) return data
    if (data && typeof data === 'object' && 'data' in data) {
      const inner = (data as Record<string, unknown>).data
      if (Array.isArray(inner)) return inner
    }
    return []
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
      className="absolute bottom-full right-0 z-50 mb-2 w-96 rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
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
                onSelect(getShareUrl(item))
                onClose()
              }}
              className="group relative overflow-hidden rounded-md hover:ring-2 hover:ring-indigo-500"
              title={item.title}
            >
              {hasVideo(item) ? (
                <video
                  src={getPreviewUrl(item)}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="h-28 w-full object-cover"
                />
              ) : (
                <img
                  src={getPreviewUrl(item)}
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
