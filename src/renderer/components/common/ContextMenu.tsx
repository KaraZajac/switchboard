import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Delay adding click listener to avoid catching the opening right-click
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClick)
    })
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // Adjust position to stay on screen
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md bg-gray-900 py-1 shadow-xl ring-1 ring-gray-700"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="mx-2 my-1 border-t border-gray-700" />
        ) : (
          <button
            key={i}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            className={`w-full px-3 py-1.5 text-left text-sm ${
              item.disabled
                ? 'cursor-not-allowed text-gray-600'
                : item.danger
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
