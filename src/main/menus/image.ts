import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/**
 * What a right-click offers on a picture.
 *
 * Chromium's own context menu does not exist in an Electron app — either the
 * app builds one or right-clicking does nothing at all, which is what happened
 * here. That was survivable while every embedded picture printed its address
 * above it: the address could be copied, and clicking the picture opened a
 * lightbox with a download button in it. Now the picture stands in for the
 * address, so the ways of getting at the thing have to be on the picture.
 *
 * The template is built here, away from the window, because everything
 * interesting about it — whether there is a menu at all, and what is on it —
 * is worth a test, and a native menu is not something a test can open.
 */
export interface ImageMenuActions {
  /** Save the picture, asking where */
  save: () => void
  /** Put the picture itself on the clipboard */
  copy: () => void
  /** Put its address on the clipboard */
  copyLink: () => void
  /** Hand it to the browser */
  open: () => void
}

/**
 * The menu for this click, or null where there is nothing to offer.
 *
 * Null rather than an empty menu: an empty menu that opens is worse than no
 * menu, because it looks like the app has nothing to say about something it
 * has not been asked about.
 */
export function imageMenuTemplate(
  params: Pick<ContextMenuParams, 'mediaType' | 'srcURL'>,
  actions: ImageMenuActions
): MenuItemConstructorOptions[] | null {
  if (params.mediaType !== 'image') return null
  if (!params.srcURL) return null

  return [
    { label: 'Save image as…', click: actions.save },
    { label: 'Copy image', click: actions.copy },
    { type: 'separator' },
    { label: 'Copy image address', click: actions.copyLink },
    { label: 'Open image in browser', click: actions.open }
  ]
}
