/**
 * Klipy, the GIF picker's source.
 *
 * What the API returns and which of the several files in an answer to draw
 * and to send lives here rather than in the desktop's picker, because the
 * phone has the same picker and must choose the same files: a GIF picked on
 * one device is a link the other has to show. The Kotlin half is `Klipy.kt`,
 * and both are checked against `tests/fixtures/klipy.json`.
 */

export const KLIPY_API_KEY = '1xQDx9n6q39fXn2j7FbcqMfkyMycbdhu2TuekgY2olcinbjC5lhty6JV7ue1mK0l'
export const KLIPY_API_BASE = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}`

export type KlipyTab = 'gifs' | 'stickers' | 'clips' | 'static-memes' | 'emojis'

export const KLIPY_TABS: { id: KlipyTab; label: string }[] = [
  { id: 'gifs', label: 'GIFs' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'clips', label: 'Clips' },
  { id: 'static-memes', label: 'Memes' },
  { id: 'emojis', label: 'Emoji' }
]

/** File format entry from the Klipy API */
export interface KlipyFormat {
  url: string
  width?: number
  height?: number
  size?: number
}

/** A size variant containing several formats */
export interface KlipySize {
  gif?: KlipyFormat
  webp?: KlipyFormat
  mp4?: KlipyFormat
  webm?: KlipyFormat
  jpg?: KlipyFormat
  png?: KlipyFormat
}

/** A Klipy item — clips use flat file URLs, other types nested size variants */
export interface KlipyItem {
  url: string
  title?: string
  slug?: string
  file?: {
    hd?: KlipySize
    md?: KlipySize
    sm?: KlipySize
    xs?: KlipySize
    mp4?: string
    gif?: string
    webp?: string
    png?: string
    jpg?: string
  }
}

/** The address to fetch a tab's trending list, or a search in it */
export function klipyTrendingUrl(tab: KlipyTab, perPage = 20): string {
  return `${KLIPY_API_BASE}/${tab}/trending?per_page=${perPage}`
}

export function klipySearchUrl(tab: KlipyTab, query: string, perPage = 20): string {
  return `${KLIPY_API_BASE}/${tab}/search?q=${encodeURIComponent(query)}&per_page=${perPage}`
}

/** Whether the file object uses the flat format (clips) rather than size variants */
export function isFlat(file: NonNullable<KlipyItem['file']>): boolean {
  return typeof file.mp4 === 'string' || typeof file.gif === 'string' || typeof file.webp === 'string'
}

/** The best preview: a small animated format for a thumbnail */
export function previewUrl(item: KlipyItem): string {
  const f = item.file
  if (!f) return item.url
  if (isFlat(f)) return f.webp || f.gif || f.mp4 || item.url
  const variant = f.sm || f.md || f.hd || f.xs
  if (!variant) return item.url
  return variant.webp?.url || variant.gif?.url || variant.png?.url || variant.mp4?.url || item.url
}

/** The best address to send: the HD animated one */
export function shareUrl(item: KlipyItem): string {
  const f = item.file
  if (!f) return item.url
  if (isFlat(f)) return f.gif || f.mp4 || f.webp || item.url
  const variant = f.hd || f.md || f.sm
  if (!variant) return item.url
  return variant.gif?.url || variant.webp?.url || variant.mp4?.url || variant.png?.url || item.url
}

/** Whether the item is a video with no still or animated image alongside */
export function hasVideo(item: KlipyItem): boolean {
  const f = item.file
  if (!f) return false
  if (isFlat(f)) return !!(f.mp4 && !f.gif && !f.webp && !f.png)
  const variant = f.sm || f.md || f.hd
  return !!(variant?.mp4?.url && !variant?.gif?.url && !variant?.webp?.url && !variant?.png?.url)
}

/** The items out of an answer, which the API wraps one way for trending and another for search */
export function parseResults(json: unknown): KlipyItem[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as Record<string, unknown>).data
  if (Array.isArray(data)) return data as KlipyItem[]
  if (data && typeof data === 'object' && 'data' in data) {
    const inner = (data as Record<string, unknown>).data
    if (Array.isArray(inner)) return inner as KlipyItem[]
  }
  return []
}
