/**
 * Keeping the window somewhere you can see it.
 *
 * A window remembers where it was; a screen does not have to still be there.
 * Unplug a monitor, let a USB display drop, or have the compositor hand back a
 * different set of outputs than it took away, and a window can be left sitting
 * at coordinates that belong to nothing. It is not minimised, not hidden and
 * not closed — `isVisible()` says true and `show()` and `focus()` both do
 * exactly what they are asked, which is to make sure something nobody can see
 * is visible and focused.
 *
 * That is the state where the app is running, the tray icon is there, and
 * there is no window anywhere.
 *
 * Geometry only, and no Electron: this is the part worth being sure about, and
 * being sure about it should not need a display.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * How much of a window has to be on a screen before it counts as reachable.
 *
 * A fraction rather than a number of pixels, because "enough to grab" scales
 * with the window: a sliver of a large window is as unusable as a sliver of a
 * small one. A fifth leaves a window that is mostly off the side alone — that
 * is somewhere a person can have deliberately put it — and rescues one that is
 * essentially gone.
 */
const ENOUGH = 0.2

/** The part of `a` that is inside `b`, or null where they do not meet */
function overlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

/** How much of `window` is on some screen. Screens are assumed not to overlap. */
export function visibleArea(window: Rect, screens: readonly Rect[]): number {
  let total = 0
  for (const screen of screens) {
    const shared = overlap(window, screen)
    if (shared) total += area(shared)
  }
  return total
}

/** Whether enough of the window is somewhere a person could reach it */
export function isReachable(window: Rect, screens: readonly Rect[]): boolean {
  const wanted = area(window)
  // A window with no size is not a window, and dividing by its area is not a
  // question. Treat it as reachable so nothing moves it about.
  if (wanted <= 0) return true
  return visibleArea(window, screens) / wanted >= ENOUGH
}

/**
 * Where the window should go, or null if it is already fine.
 *
 * Centred on the first screen given, which the caller passes as the primary
 * one — the screen somebody is looking at when they wonder where the window
 * went. Shrunk to fit if the window is larger than what is left, because a
 * window centred on a screen it does not fit is the same problem again with
 * its edges off two sides instead of one.
 */
export function bringOnScreen(window: Rect, screens: readonly Rect[]): Rect | null {
  // Nothing to be on. This happens for real — a compositor that has lost every
  // output reports none until it has them back — and moving a window to
  // nowhere in particular is worse than leaving it where it was.
  if (screens.length === 0) return null
  if (isReachable(window, screens)) return null

  const home = screens[0]
  const width = Math.min(window.width, home.width)
  const height = Math.min(window.height, home.height)
  return {
    x: Math.round(home.x + (home.width - width) / 2),
    y: Math.round(home.y + (home.height - height) / 2),
    width,
    height
  }
}
