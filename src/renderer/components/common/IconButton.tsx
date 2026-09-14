import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * One scale for every icon in the app.
 *
 * Before this there were seven glyph sizes for comparable jobs, two icon
 * families (filled Material beside stroked Feather), five hit-area sizes and
 * letters standing in for icons — the same gear was 20px in one bar and 16px
 * in the next. Two sizes cover everything:
 *
 * - `md`: a 20px glyph in a 32px button — the bars and the composer.
 * - `sm`: a 16px glyph in a 24px button — inside rows and section headers.
 *
 * Everything is stroked at the same weight, so nothing looks heavier than
 * its neighbour.
 */
export const ICON = { sm: 16, md: 20 } as const
export type IconSize = keyof typeof ICON

const BUTTON: Record<IconSize, string> = {
  sm: 'h-6 w-6 rounded',
  md: 'h-8 w-8 rounded-md'
}

/** Paint depends on what the button sits on */
const HOVER = {
  panel: 'hover:bg-gray-700',
  raised: 'hover:bg-gray-600'
} as const
const ACTIVE = {
  panel: 'bg-gray-700',
  raised: 'bg-gray-600'
} as const

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** What it does — the tooltip and the accessible name */
  label: string
  size?: IconSize
  /** A toggle that is on */
  active?: boolean
  /** Red on hover: removing, closing for good */
  danger?: boolean
  /** `raised` for a button on a lighter surface, like the composer box */
  surface?: keyof typeof HOVER
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  active = false,
  danger = false,
  surface = 'panel',
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  const paint = active
    ? `${ACTIVE[surface]} text-gray-100`
    : `text-gray-400 ${HOVER[surface]} ${danger ? 'hover:text-red-400' : 'hover:text-gray-100'}`

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`inline-flex shrink-0 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50 ${BUTTON[size]} ${paint} ${className}`}
      {...rest}
    >
      <Icon size={ICON[size]} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
