interface TypingIndicatorProps {
  nicks: string[]
}

export function TypingIndicator({ nicks }: TypingIndicatorProps) {
  if (nicks.length === 0) return <div className="h-6" />

  let text: string
  if (nicks.length === 1) {
    text = `${nicks[0]} is typing...`
  } else if (nicks.length === 2) {
    text = `${nicks[0]} and ${nicks[1]} are typing...`
  } else if (nicks.length === 3) {
    text = `${nicks[0]}, ${nicks[1]}, and ${nicks[2]} are typing...`
  } else {
    text = `${nicks[0]}, ${nicks[1]}, and ${nicks.length - 2} others are typing...`
  }

  return (
    <div className="flex h-6 items-center px-4">
      {/* Animated dots */}
      <span className="mr-2 flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
      </span>
      <span className="text-xs text-gray-400">{text}</span>
    </div>
  )
}
