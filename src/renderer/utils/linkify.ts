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

export type MessageSegment = TextSegment | LinkSegment | CodeSegment

/**
 * URL regex that matches common URL patterns.
 * Handles http(s), ftp, and bare domain patterns.
 */
const URL_REGEX =
  /https?:\/\/[^\s<>"\])}]+|ftp:\/\/[^\s<>"\])}]+/gi

/** Inline code regex: `code` */
const INLINE_CODE_REGEX = /`([^`\n]+)`/g

/** Code block regex: ```code``` */
const CODE_BLOCK_REGEX = /```(?:\w*\n)?([\s\S]*?)```/g

/**
 * Parse message text into segments (text, links, code blocks).
 */
export function parseMessageContent(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []

  // First extract code blocks
  let remaining = text
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
 * Split text into text and link segments.
 */
function linkifyText(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  const regex = new RegExp(URL_REGEX.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Text before the URL
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    let url = match[0]
    // Clean trailing punctuation that's likely not part of the URL
    const trailingPunct = /[.,;:!?)]+$/
    const trailingMatch = url.match(trailingPunct)
    if (trailingMatch) {
      // Keep closing parens if there's a matching open paren in the URL
      const cleaned = url.replace(trailingPunct, '')
      const openParens = (cleaned.match(/\(/g) || []).length
      const closeParens = (cleaned.match(/\)/g) || []).length
      if (openParens <= closeParens) {
        url = cleaned
      }
    }

    segments.push({
      type: 'link',
      url,
      display: url.length > 80 ? url.slice(0, 77) + '...' : url
    })

    lastIndex = match.index + url.length
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
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
