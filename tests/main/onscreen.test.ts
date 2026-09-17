import { describe, it, expect } from 'vitest'
import { bringOnScreen, isReachable, visibleArea } from '../../src/main/window/onscreen'
import type { Rect } from '../../src/main/window/onscreen'

/**
 * A window on a screen that is no longer there.
 *
 * This is the shape of the bug it exists for: the app is running, the tray
 * icon is in the panel, and there is no window anywhere — because the window
 * is at coordinates that used to be a second monitor. Nothing reports it as
 * hidden, so nothing puts it back.
 *
 * The numbers below are the two screens this was found on: a 2560x1440 laptop
 * panel at the origin and a 1920x1080 USB display to the right of it, the one
 * that comes and goes.
 */
const LAPTOP: Rect = { x: 0, y: 0, width: 2560, height: 1440 }
const USB: Rect = { x: 2560, y: 0, width: 1920, height: 1080 }
const BOTH = [LAPTOP, USB]

/** Where Switchboard opens: its default size, centred on the laptop */
const centred: Rect = { x: 640, y: 320, width: 1280, height: 800 }

describe('whether a window can be reached', () => {
  it('a window on the screen can be', () => {
    expect(isReachable(centred, BOTH)).toBe(true)
  })

  it('and one on the second screen can be, while there are two', () => {
    const onUsb: Rect = { x: 2880, y: 140, width: 1280, height: 800 }
    expect(isReachable(onUsb, BOTH)).toBe(true)
  })

  it('but not once that screen has gone', () => {
    const onUsb: Rect = { x: 2880, y: 140, width: 1280, height: 800 }
    expect(isReachable(onUsb, [LAPTOP])).toBe(false)
  })

  it('a window hanging off an edge is somewhere somebody put it', () => {
    // Two thirds off the right of the laptop, a third still showing. People
    // park windows like this on purpose and it must not be dragged back.
    const parked: Rect = { x: 2133, y: 300, width: 1280, height: 800 }
    expect(isReachable(parked, [LAPTOP])).toBe(true)
  })

  it('one with a sliver showing cannot be', () => {
    const sliver: Rect = { x: 2500, y: 300, width: 1280, height: 800 }
    expect(isReachable(sliver, [LAPTOP])).toBe(false)
  })

  it('and nor can one above the top of everything', () => {
    const above: Rect = { x: 640, y: -790, width: 1280, height: 800 }
    expect(isReachable(above, BOTH)).toBe(false)
  })

  it('a window spanning the join between two screens is fine', () => {
    const spanning: Rect = { x: 1920, y: 200, width: 1280, height: 800 }
    expect(visibleArea(spanning, BOTH)).toBe(1280 * 800)
    expect(isReachable(spanning, BOTH)).toBe(true)
  })

  it('a window with no size is left alone rather than divided by zero', () => {
    expect(isReachable({ x: 9999, y: 9999, width: 0, height: 0 }, [LAPTOP])).toBe(true)
  })
})

describe('putting it back', () => {
  it('leaves a window that is already visible where it is', () => {
    expect(bringOnScreen(centred, BOTH)).toBeNull()
  })

  it('centres a stranded window on the screen it is told is home', () => {
    const stranded: Rect = { x: 2880, y: 140, width: 1280, height: 800 }
    expect(bringOnScreen(stranded, [LAPTOP])).toEqual({
      x: 640,
      y: 320,
      width: 1280,
      height: 800
    })
  })

  it('shrinks a window too big for what is left', () => {
    // The laptop is gone and only the smaller display remains; a 2000x1300
    // window centred on it would hang off all four sides.
    const big: Rect = { x: -3000, y: 0, width: 2000, height: 1300 }
    expect(bringOnScreen(big, [USB])).toEqual({
      x: 2560,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('does nothing at all when there are no screens', () => {
    // A compositor that has lost every output says so for a moment before it
    // has them back. Moving the window to nowhere would be worse than waiting.
    expect(bringOnScreen(centred, [])).toBeNull()
  })
})
