import { useState, useRef, useCallback, type KeyboardEvent } from 'react'

interface MessageComposerProps {
  channel: string
  onSend: (text: string) => void
  disabled?: boolean
}

export function MessageComposer({ channel, onSend, disabled }: MessageComposerProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (text.trim() && !disabled) {
          onSend(text.trim())
          setText('')
        }
      }
    },
    [text, onSend, disabled]
  )

  const handleInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px'
    }
  }, [])

  return (
    <div className="px-4 pb-6 pt-0">
      <div className="rounded-lg bg-gray-700">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            handleInput()
          }}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Not connected' : `Message ${channel}`}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 py-3 text-gray-100 placeholder-gray-400 outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: '200px' }}
        />
      </div>
    </div>
  )
}
