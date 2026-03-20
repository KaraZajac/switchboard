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
