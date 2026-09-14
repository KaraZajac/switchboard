import { useEffect, useRef, useState } from 'react'
import { EMOJI, emojiCandidates } from '@shared/emoji'

/**
 * The emoji picker: a box to type a name into and the table underneath.
 *
 * Typing `:smi` in the composer already offers the nearest names; this is
 * for the other case, where you know the face you want and not what it is
 * called. The same table as the shortcodes, so what is picked here is what
 * `:name:` would have produced.
 */
export function EmojiPicker({
  onSelect,
  onClose
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Everything when nothing is typed, the nearest two hundred otherwise.
  // Drawing all twelve hundred is fine; drawing them on every keystroke of a
  // search would not be.
  const shown = search.trim() ? emojiCandidates(search.trim(), EMOJI, 200) : EMOJI

  return (
    <div
      className="absolute bottom-full right-2 z-30 mb-2 flex w-80 flex-col rounded-lg bg-gray-900 shadow-xl ring-1 ring-gray-700"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name — smile, tada, cat…"
          className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
        />
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300"
          title="Close"
          type="button"
        >
          ×
        </button>
      </div>
      <div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {shown.map((entry) => (
          <button
            key={entry.name}
            type="button"
            onClick={() => onSelect(entry.emoji)}
            title={`:${entry.name}:`}
            className="flex h-8 w-8 items-center justify-center rounded text-xl hover:bg-gray-700"
          >
            {entry.emoji}
          </button>
        ))}
        {shown.length === 0 && (
          <div className="col-span-8 px-2 py-4 text-center text-xs text-gray-500">
            Nothing called that.
          </div>
        )}
      </div>
    </div>
  )
}
