import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { type ReactNode, useEffect, useRef } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex animate-[fade-in_120ms_ease-out] items-center justify-center bg-black/70"
    >
      <div
        className={`${width} w-full animate-[modal-in_140ms_ease-out] rounded-lg bg-gray-800 shadow-2xl ring-1 ring-gray-950/60`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>

        {/* Body */}
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
