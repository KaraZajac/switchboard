import { ChevronDown, type LucideIcon } from 'lucide-react'
import { ICON, IconButton } from './IconButton'

/**
 * A heading inside a list: CHANNELS, FRIENDS, OPS — 1.
 *
 * One component because the three places that drew one each drew it
 * differently — one could fold away and one could not, one nudged its label
 * with a hand-picked `pl-[15px]`, and each spaced itself by its own
 * numbers. Here the fold chevron sits on the row's left edge, where the `#`
 * of a channel row sits, and the action on the right lines up with the
 * chevron in the panel header above.
 */
interface SectionHeaderProps {
  label: string
  count?: number
  /** Present when the section can fold away */
  collapsed?: boolean
  onToggle?: () => void
  /** The one thing you can add here */
  action?: { icon: LucideIcon; label: string; onClick: () => void }
  className?: string
}

export function SectionHeader({
  label,
  count,
  collapsed = false,
  onToggle,
  action,
  className = ''
}: SectionHeaderProps) {
  const text = count === undefined ? label : `${label} — ${count}`
  const heading = 'text-xs font-semibold uppercase tracking-wide'

  return (
    <div className={`mb-0.5 mt-3 flex h-6 items-center pl-2 pr-1 ${className}`}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
          className={`flex min-w-0 flex-1 items-center gap-2 text-gray-400 transition-colors hover:text-gray-200 ${heading}`}
        >
          <ChevronDown
            size={ICON.sm}
            strokeWidth={2}
            aria-hidden="true"
            className={`shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <span className="truncate">{text}</span>
        </button>
      ) : (
        <span className={`min-w-0 flex-1 truncate text-gray-400 ${heading}`}>{text}</span>
      )}
      {action && (
        <IconButton size="sm" icon={action.icon} label={action.label} onClick={action.onClick} />
      )}
    </div>
  )
}
