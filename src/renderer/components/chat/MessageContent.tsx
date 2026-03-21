import { useState, useEffect } from 'react'
import { parseIRCFormatting, type FormattedSpan } from '../../utils/formatting'
import { parseMessageContent, isImageUrl, isKlipyMediaUrl, isVideoUrl, isAudioUrl, getFilenameFromUrl, getFileTypeInfo, type MessageSegment } from '../../utils/linkify'
import { useServerStore } from '../../stores/serverStore'
import type { LinkPreviewData } from '@shared/types/ipc'

interface MessageContentProps {
  text: string
  highlightNick?: string
}

/**
 * Renders message text with IRC formatting, URLs, and code blocks.
 */
export function MessageContent({ text, highlightNick }: MessageContentProps) {
  const segments = parseMessageContent(text)

  return (
    <span>
      {segments.map((segment, i) => (
        <Segment key={i} segment={segment} highlightNick={highlightNick} />
      ))}
    </span>
  )
}

function Segment({ segment, highlightNick }: { segment: MessageSegment; highlightNick?: string }) {
  switch (segment.type) {
    case 'text':
      return <FormattedText text={segment.content} highlightNick={highlightNick} />

    case 'link': {
      // Klipy media: render inline without URL text
      if (isKlipyMediaUrl(segment.url)) {
        return <KlipyMedia url={segment.url} />
      }

      // Filehost uploads: render inline media or file card (no URL text)
      if (isFilehostUrl(segment.url)) {
        return <FilehostMedia url={segment.url} />
      }

      return (
        <>
          <a
            href={segment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
            title={segment.url}
          >
            {segment.display}
          </a>
          {/* Image preview */}
          {isImageUrl(segment.url) ? (
            <div className="mt-1">
              <img
                src={segment.url}
                alt="Preview"
                className="max-h-64 max-w-md rounded"
                loading="lazy"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          ) : (
            <LinkPreview url={segment.url} />
          )}
        </>
      )
    }

    case 'code':
      if (segment.inline) {
        return (
          <code className="rounded bg-gray-900 px-1.5 py-0.5 text-sm text-gray-200">
            {segment.content}
          </code>
        )
      }
      return (
        <pre className="my-1 overflow-x-auto rounded bg-gray-900 p-3">
          <code className="text-sm text-gray-200">{segment.content}</code>
        </pre>
      )

    case 'markdown':
      return <MarkdownSpan style={segment.style} content={segment.content} />
  }
}

function MarkdownSpan({ style, content }: { style: string; content: string }) {
  const [revealed, setRevealed] = useState(false)

  switch (style) {
    case 'bold':
      return <strong className="font-bold">{content}</strong>
    case 'italic':
      return <em className="italic">{content}</em>
    case 'boldItalic':
      return <strong className="font-bold italic">{content}</strong>
    case 'strikethrough':
      return <span className="line-through">{content}</span>
    case 'spoiler':
      return (
        <span
          onClick={() => setRevealed(!revealed)}
          className={`cursor-pointer rounded px-0.5 transition-colors ${
            revealed
              ? 'bg-gray-700 text-gray-200'
              : 'bg-gray-500 text-transparent hover:bg-gray-400'
          }`}
        >
          {content}
        </span>
      )
    case 'heading':
      return <span className="text-lg font-bold text-gray-100">{content}</span>
    default:
      return <span>{content}</span>
  }
}

function FormattedText({ text, highlightNick }: { text: string; highlightNick?: string }) {
  const spans = parseIRCFormatting(text)

  // If no formatting, just return plain text (with possible highlighting)
  if (spans.length === 1 && !hasFormatting(spans[0])) {
    return <>{highlightNick ? highlightMentions(spans[0].text, highlightNick) : spans[0].text}</>
  }

  return (
    <>
      {spans.map((span, i) => {
        if (!hasFormatting(span)) {
          return <span key={i}>{span.text}</span>
        }

        const style: React.CSSProperties = {}
        const classes: string[] = []

        if (span.bold) classes.push('font-bold')
        if (span.italic) classes.push('italic')
        if (span.underline) classes.push('underline')
        if (span.strikethrough) classes.push('line-through')
        if (span.monospace) classes.push('font-mono text-sm')
        if (span.fg) style.color = span.fg
        if (span.bg) {
          style.backgroundColor = span.bg
          classes.push('px-0.5 rounded')
        }

        return (
          <span key={i} className={classes.join(' ')} style={style}>
            {highlightNick ? highlightMentions(span.text, highlightNick) : span.text}
          </span>
        )
      })}
    </>
  )
}

function highlightMentions(text: string, nick: string): React.ReactNode {
  if (!nick) return text
  const regex = new RegExp(`(\\b${nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="rounded bg-amber-500/20 px-0.5 font-semibold text-amber-300">
        {part}
      </span>
    ) : (
      part
    )
  )
}

function hasFormatting(span: FormattedSpan): boolean {
  return (
    span.bold ||
    span.italic ||
    span.underline ||
    span.strikethrough ||
    span.monospace ||
    span.fg !== null ||
    span.bg !== null
  )
}

/** Render Klipy media inline (no URL text shown) */
function KlipyMedia({ url }: { url: string }) {
  if (isVideoUrl(url)) {
    return (
      <div className="mt-1">
        <video
          src={url}
          muted
          loop
          autoPlay
          playsInline
          className="max-h-64 max-w-md rounded"
        />
      </div>
    )
  }
  return (
    <div className="mt-1">
      <img
        src={url}
        alt=""
        className="max-h-64 max-w-md rounded"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    </div>
  )
}

/** Fetch and display OpenGraph link preview */
function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null)

  useEffect(() => {
    let cancelled = false
    window.switchboard.invoke('link-preview:fetch', url).then((data) => {
      if (!cancelled && data) setPreview(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [url])

  if (!preview || (!preview.title && !preview.description && !preview.image)) return null

  return (
    <div className="mt-1.5 max-w-md overflow-hidden rounded border-l-4 border-indigo-500 bg-gray-800/80">
      <a href={url} target="_blank" rel="noopener noreferrer" className="block hover:bg-gray-700/50 transition-colors">
        {preview.image && (
          <img
            src={preview.image}
            alt=""
            className="max-h-48 w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="px-3 py-2">
          {preview.siteName && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              {preview.favicon && (
                <img
                  src={preview.favicon}
                  alt=""
                  className="h-3.5 w-3.5"
                  onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              {preview.siteName}
            </div>
          )}
          {preview.title && (
            <div className="mt-0.5 text-sm font-medium text-blue-400">{preview.title}</div>
          )}
          {preview.description && (
            <div className="mt-0.5 text-xs text-gray-400 line-clamp-2">{preview.description}</div>
          )}
        </div>
      </a>
    </div>
  )
}

/** Check if a URL belongs to a known filehost for any connected server */
function isFilehostUrl(url: string): boolean {
  const filehostUrls = useServerStore.getState().filehostUrls
  for (const baseUrl of Object.values(filehostUrls)) {
    if (url.startsWith(baseUrl)) return true
  }
  return false
}

/** Format file size in human-readable form */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Render filehost uploads — inline for media, file card for other types */
function FilehostMedia({ url }: { url: string }) {
  // Images: render inline
  if (isImageUrl(url)) {
    return (
      <div className="mt-1">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={getFilenameFromUrl(url)}
            className="max-h-64 max-w-md rounded"
            loading="lazy"
            onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
          />
        </a>
      </div>
    )
  }

  // Videos: render inline player
  if (isVideoUrl(url)) {
    return (
      <div className="mt-1">
        <video
          src={url}
          controls
          playsInline
          className="max-h-80 max-w-md rounded"
        />
      </div>
    )
  }

  // Audio: render inline player
  if (isAudioUrl(url)) {
    return (
      <div className="mt-1">
        <audio src={url} controls className="max-w-md" />
      </div>
    )
  }

  // Everything else: file card
  return <FileCard url={url} />
}

/** A download card for non-media file types */
function FileCard({ url }: { url: string }) {
  const filename = getFilenameFromUrl(url)
  const typeInfo = getFileTypeInfo(filename)
  const [fileSize, setFileSize] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // HEAD request to get file size
    fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (!cancelled) {
          const len = res.headers.get('Content-Length')
          if (len) setFileSize(parseInt(len, 10))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])

  return (
    <div className="mt-1.5 max-w-sm">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg border border-gray-600 bg-gray-800/80 px-3 py-2.5 transition-colors hover:bg-gray-700/50"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-700 text-xl">
          {typeInfo?.icon || '📎'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-blue-400">{filename}</div>
          <div className="text-xs text-gray-400">
            {fileSize !== null ? formatFileSize(fileSize) : typeInfo?.label || 'File'}
            {fileSize !== null && typeInfo ? ` · ${typeInfo.label}` : ''}
          </div>
        </div>
        <svg className="h-5 w-5 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
      </a>
    </div>
  )
}
