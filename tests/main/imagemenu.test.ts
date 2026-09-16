import { describe, it, expect, vi } from 'vitest'
import { imageMenuTemplate } from '../../src/main/menus/image'

/**
 * What a right-click offers on a picture.
 *
 * The menu itself is native and a test cannot open one, so what is checked
 * here is the part that decides: whether there is a menu at all, what is on
 * it, and that each item does the thing it is named after. The popping is one
 * line in `index.ts`.
 */
const actions = (): Record<'save' | 'copy' | 'copyLink' | 'open', ReturnType<typeof vi.fn>> => ({
  save: vi.fn(),
  copy: vi.fn(),
  copyLink: vi.fn(),
  open: vi.fn()
})

const onImage = { mediaType: 'image' as const, srcURL: 'https://example.org/cat.png' }

describe('a right-click on a picture', () => {
  it('offers to save it, copy it, copy its address and open it', () => {
    const template = imageMenuTemplate(onImage, actions())

    expect(template?.map((item) => item.label ?? item.type)).toEqual([
      'Save image as…',
      'Copy image',
      'separator',
      'Copy image address',
      'Open image in browser'
    ])
  })

  it('does each of those things when asked', () => {
    const did = actions()
    const template = imageMenuTemplate(onImage, did)

    for (const item of template ?? []) item.click?.(null as never, undefined, null as never)

    expect(did.save).toHaveBeenCalledOnce()
    expect(did.copy).toHaveBeenCalledOnce()
    expect(did.copyLink).toHaveBeenCalledOnce()
    expect(did.open).toHaveBeenCalledOnce()
  })
})

describe('a right-click on anything else', () => {
  it('offers nothing on ordinary text', () => {
    // An empty menu that opens is worse than no menu: it looks like the app
    // has nothing to say about something it was never asked about
    expect(imageMenuTemplate({ mediaType: 'none', srcURL: '' }, actions())).toBe(null)
  })

  it('offers nothing on a video, which has its own controls', () => {
    expect(
      imageMenuTemplate({ mediaType: 'video', srcURL: 'https://example.org/clip.mp4' }, actions())
    ).toBe(null)
  })

  it('offers nothing for a picture with no address', () => {
    // A canvas, or an image whose source the page never gave
    expect(imageMenuTemplate({ mediaType: 'image', srcURL: '' }, actions())).toBe(null)
  })
})
