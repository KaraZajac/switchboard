import { parseIRCFormatting, type FormattedSpan } from '../../utils/formatting'
import { parseMessageContent, isImageUrl, type MessageSegment } from '../../utils/linkify'

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

    case 'link':
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
          {isImageUrl(segment.url) && (
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
          )}
        </>
      )

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
