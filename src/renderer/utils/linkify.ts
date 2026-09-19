/**
 * URL detection and linkification.
 *
 * Detects URLs in text and splits the text into segments
 * of plain text and link objects for rendering.
 */

import { findLinks } from '@shared/links'
import { SPOILER, spoilers } from '@shared/markdown'

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

/**
 * A run somebody asked to be covered until it is clicked.
 *
 * The only markup read on the way *in*. Bold, italics and the rest arrive as
 * control bytes — see `@shared/markdown`, which converts what was typed on the
 * way out so a message is bold for everybody rather than for this client
 * alone. Reading them here as well used to *delete characters from what other
 * people said*: `ban *!*@host` was drawn as `ban !@host` with the `!` in
 * italics, `2 * 3 * 4 = 24` as `2  3  4 = 24`, and a line beginning `# 1 of 3`
 * lost its `#` to a heading. A mask shown wrong is a ban placed wrong.
 *
 * `||…||` stays because IRC has no byte for it, so there is nothing else it
 * could arrive as.
 */
export interface MarkdownSegment {
  type: 'markdown'
  content: string
  style: 'spoiler'
}

export type MessageSegment = TextSegment | LinkSegment | CodeSegment | MarkdownSegment

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
    const overlaps = codeBlocks.some((b) => match!.index >= b.start && match!.index < b.end)
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
 * Split text into text, link, and markdown segments.
 */
function linkifyText(text: string): MessageSegment[] {
  // Links and spoilers, by position, so neither lands inside the other
  const tokens: { start: number; end: number; segment: MessageSegment }[] = []

  // Find URLs, by the same rule the phone uses — the two had their own
  // patterns and disagreed about where a link ends
  for (const link of findLinks(text)) {
    tokens.push({
      start: link.start,
      end: link.end,
      segment: {
        type: 'link',
        url: link.url,
        display: link.url.length > 80 ? link.url.slice(0, 77) + '...' : link.url
      }
    })
  }

  // Find what is covered, by the rule the phone uses rather than a second
  // one of this file's own — the two clients have to agree about where a
  // spoiler starts or the same message reads differently on each.
  let at = 0
  for (const run of spoilers(text)) {
    const width = run.hidden ? run.text.length + SPOILER.length * 2 : run.text.length
    if (run.hidden) {
      const overlaps = tokens.some((t) => at < t.end && at + width > t.start)
      if (!overlaps) {
        tokens.push({
          start: at,
          end: at + width,
          segment: { type: 'markdown', content: run.text, style: 'spoiler' }
        })
      }
    }
    at += width
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

// What an address points at is decided once, for both clients — see `@shared/links`
export { isImageUrl, isKlipyMediaUrl, isVideoUrl } from '@shared/links'

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
  '.csv': { icon: '📊', label: 'CSV' }
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
