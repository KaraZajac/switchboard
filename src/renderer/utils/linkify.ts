/**
 * URL detection and linkification.
 *
 * Detects URLs in text and splits the text into segments
 * of plain text and link objects for rendering.
 */

export interface TextSegment {
  type: 'text'
  content: string
}

export interface LinkSegment {
  type: 'link'
  url: string
  display: string
}

export interface CodeSegment {
  type: 'code'
  content: string
  inline: boolean
}

export interface MarkdownSegment {
  type: 'markdown'
  content: string
  style: 'bold' | 'italic' | 'boldItalic' | 'strikethrough' | 'spoiler' | 'heading'
}

export type MessageSegment = TextSegment | LinkSegment | CodeSegment | MarkdownSegment

/**
 * URL regex that matches common URL patterns.
 * Handles http(s), ftp, and bare domain patterns.
 */
const URL_REGEX =
  /https?:\/\/[^\s<>"\])}]+|ftp:\/\/[^\s<>"\])}]+/gi

/**
 * Parse message text into segments (text, links, code blocks).
 */
export function parseMessageContent(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []

  const codeBlocks: { start: number; end: number; content: string; inline: boolean }[] = []

  // Find code blocks (``` ... ```)
  let match: RegExpExecArray | null
  const blockRegex = /```(?:\w*\n)?([\s\S]*?)```/g
  while ((match = blockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1],
      inline: false
    })
  }

  // Find inline code (` ... `)
  const inlineRegex = /`([^`\n]+)`/g
  while ((match = inlineRegex.exec(text)) !== null) {
    // Don't overlap with code blocks
    const overlaps = codeBlocks.some(
      (b) => match!.index >= b.start && match!.index < b.end
    )
    if (!overlaps) {
      codeBlocks.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        inline: true
      })
    }
  }

  // Sort by position
  codeBlocks.sort((a, b) => a.start - b.start)

  // Build segments
  let pos = 0
  for (const block of codeBlocks) {
    // Process text before the code block
    if (block.start > pos) {
      const textBefore = text.slice(pos, block.start)
      segments.push(...linkifyText(textBefore))
    }

    segments.push({
      type: 'code',
      content: block.content,
      inline: block.inline
    })

    pos = block.end
  }

  // Process remaining text
  if (pos < text.length) {
    segments.push(...linkifyText(text.slice(pos)))
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }]
}

/**
 * Markdown-style patterns: order matters (longest delimiters first).
 * Each pattern matches opening delimiter + content + closing delimiter.
 */
const MARKDOWN_PATTERNS: { regex: RegExp; style: MarkdownSegment['style'] }[] = [
  { regex: /\*\*\*(.+?)\*\*\*/g, style: 'boldItalic' },
  { regex: /\*\*(.+?)\*\*/g, style: 'bold' },
  { regex: /\*(.+?)\*/g, style: 'italic' },
  { regex: /~~(.+?)~~/g, style: 'strikethrough' },
  { regex: /\|\|(.+?)\|\|/g, style: 'spoiler' },
]

const HEADING_REGEX = /^(#{1,3})\s+(.+)$/gm

/**
 * Split text into text, link, and markdown segments.
 */
function linkifyText(text: string): MessageSegment[] {
  // First pass: find all markdown matches and URLs
  const tokens: { start: number; end: number; segment: MessageSegment }[] = []

  // Find URLs
  const urlRegex = new RegExp(URL_REGEX.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[0]
    const trailingPunct = /[.,;:!?)]+$/
    const trailingMatch = url.match(trailingPunct)
    if (trailingMatch) {
      const cleaned = url.replace(trailingPunct, '')
      const openParens = (cleaned.match(/\(/g) || []).length
      const closeParens = (cleaned.match(/\)/g) || []).length
      if (openParens <= closeParens) {
        url = cleaned
      }
    }
    tokens.push({
      start: match.index,
      end: match.index + url.length,
      segment: { type: 'link', url, display: url.length > 80 ? url.slice(0, 77) + '...' : url }
    })
  }

  // Find headings (must be at start of line)
  const headingRegex = new RegExp(HEADING_REGEX.source, 'gm')
  while ((match = headingRegex.exec(text)) !== null) {
    const overlaps = tokens.some((t) => match!.index < t.end && match!.index + match![0].length > t.start)
    if (!overlaps) {
      tokens.push({
        start: match.index,
        end: match.index + match[0].length,
        segment: { type: 'markdown', content: match[2], style: 'heading' }
      })
    }
  }

  // Find markdown patterns
  for (const { regex, style } of MARKDOWN_PATTERNS) {
    const mdRegex = new RegExp(regex.source, 'g')
    while ((match = mdRegex.exec(text)) !== null) {
      const overlaps = tokens.some((t) => match!.index < t.end && match!.index + match![0].length > t.start)
      if (!overlaps) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          segment: { type: 'markdown', content: match[1], style }
        })
      }
    }
  }

  // Sort by position
  tokens.sort((a, b) => a.start - b.start)

  // Build segments from tokens
  const segments: MessageSegment[] = []
  let pos = 0
  for (const token of tokens) {
    if (token.start > pos) {
      segments.push({ type: 'text', content: text.slice(pos, token.start) })
    }
    segments.push(token.segment)
    pos = token.end
  }
  if (pos < text.length) {
    segments.push({ type: 'text', content: text.slice(pos) })
  }

  return segments
}

/**
 * Check if a URL points to an image.
 */
export function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i
  return imageExtensions.test(url)
}

/**
 * Check if a URL is a Klipy media URL (should be rendered inline without link text).
 */
export function isKlipyMediaUrl(url: string): boolean {
  return /^https?:\/\/static\.klipy\.com\//i.test(url)
}

/**
 * Check if a URL points to a video.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm)(\?.*)?$/i.test(url)
}

/**
 * Check if a URL points to an audio file.
 */
export function isAudioUrl(url: string): boolean {
  return /\.(mp3|ogg|wav|flac|m4a|aac|opus)(\?.*)?$/i.test(url)
}

/**
 * Extract YouTube video ID from various URL formats.
 * Returns null if not a YouTube URL.
 */
export function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

/** File extension to icon/label mapping */
const FILE_TYPE_INFO: Record<string, { icon: string; label: string }> = {
  '.pdf': { icon: '📄', label: 'PDF' },
  '.doc': { icon: '📝', label: 'Document' },
  '.docx': { icon: '📝', label: 'Document' },
  '.xls': { icon: '📊', label: 'Spreadsheet' },
  '.xlsx': { icon: '📊', label: 'Spreadsheet' },
  '.ppt': { icon: '📊', label: 'Presentation' },
  '.pptx': { icon: '📊', label: 'Presentation' },
  '.zip': { icon: '📦', label: 'Archive' },
  '.tar': { icon: '📦', label: 'Archive' },
  '.gz': { icon: '📦', label: 'Archive' },
  '.rar': { icon: '📦', label: 'Archive' },
  '.7z': { icon: '📦', label: 'Archive' },
  '.txt': { icon: '📄', label: 'Text' },
  '.md': { icon: '📄', label: 'Markdown' },
  '.log': { icon: '📄', label: 'Log' },
  '.json': { icon: '📄', label: 'JSON' },
  '.xml': { icon: '📄', label: 'XML' },
  '.csv': { icon: '📊', label: 'CSV' },
}

/**
 * Get file type info from a filename or URL extension.
 */
export function getFileTypeInfo(nameOrUrl: string): { icon: string; label: string } | null {
  // Try as a plain filename first
  let dotIdx = nameOrUrl.lastIndexOf('.')
  if (dotIdx !== -1) {
    const ext = nameOrUrl.slice(dotIdx).toLowerCase().replace(/\?.*$/, '')
    if (FILE_TYPE_INFO[ext]) return FILE_TYPE_INFO[ext]
  }
  // Try parsing as URL
  try {
    const pathname = new URL(nameOrUrl).pathname
    dotIdx = pathname.lastIndexOf('.')
    if (dotIdx === -1) return null
    const ext = pathname.slice(dotIdx).toLowerCase()
    return FILE_TYPE_INFO[ext] || null
  } catch {
    return null
  }
}

/** Map of filehost URL → original filename (populated at upload time) */
const uploadFilenames = new Map<string, string>()

/**
 * Register the original filename for a filehost upload URL.
 */
export function registerUploadFilename(url: string, filename: string): void {
  uploadFilenames.set(url, filename)
}

/**
 * Extract a display filename from a URL, preferring the registered original name.
 */
export function getFilenameFromUrl(url: string): string {
  const registered = uploadFilenames.get(url)
  if (registered) return registered
  try {
    const pathname = new URL(url).pathname
    const name = pathname.split('/').pop() || 'file'
    return decodeURIComponent(name)
  } catch {
    return 'file'
  }
}
