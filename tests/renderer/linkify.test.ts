import { describe, it, expect } from 'vitest'
import { parseMessageContent, isImageUrl } from '../../src/renderer/utils/linkify'

describe('parseMessageContent', () => {
  it('returns plain text as single text segment', () => {
    const segments = parseMessageContent('Hello world')
    expect(segments).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('detects URLs and creates link segments', () => {
    const segments = parseMessageContent('Check out https://example.com for more')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: 'text', content: 'Check out ' })
    expect(segments[1]).toEqual(expect.objectContaining({
      type: 'link',
      url: 'https://example.com'
    }))
    expect(segments[2]).toEqual({ type: 'text', content: ' for more' })
  })

  it('truncates long URL display text', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(100)
    const segments = parseMessageContent(longUrl)
    const link = segments.find((s) => s.type === 'link')!
    expect(link.type === 'link' && link.display.length).toBeLessThanOrEqual(80)
  })

  it('strips trailing punctuation from URLs', () => {
    const segments = parseMessageContent('Visit https://example.com.')
    const link = segments.find((s) => s.type === 'link')!
    expect(link.type === 'link' && link.url).toBe('https://example.com')
  })

  it('detects inline code with backticks', () => {
    const segments = parseMessageContent('Use `console.log` for debugging')
    expect(segments).toHaveLength(3)
    expect(segments[1]).toEqual({ type: 'code', content: 'console.log', inline: true })
  })

  it('detects code blocks with triple backticks', () => {
    const segments = parseMessageContent('Here:\n```\nconst x = 1\n```\nDone')
    const codeBlock = segments.find((s) => s.type === 'code' && !s.inline)
    expect(codeBlock).toBeDefined()
    expect(codeBlock!.type === 'code' && codeBlock!.content).toContain('const x = 1')
  })

  it('does not create inline code inside code blocks', () => {
    const segments = parseMessageContent('```\nuse `this` inside\n```')
    // Should be one code block, not an inline code inside a block
    const codeBlocks = segments.filter((s) => s.type === 'code')
    expect(codeBlocks).toHaveLength(1)
    expect(codeBlocks[0].inline).toBe(false)
  })

  it('handles multiple URLs in text', () => {
    const segments = parseMessageContent('Visit https://a.com and https://b.com')
    const links = segments.filter((s) => s.type === 'link')
    expect(links).toHaveLength(2)
  })

  it('handles FTP URLs', () => {
    const segments = parseMessageContent('Download from ftp://files.example.com/data')
    const link = segments.find((s) => s.type === 'link')!
    expect(link.type === 'link' && link.url).toBe('ftp://files.example.com/data')
  })

  it('returns fallback for empty string', () => {
    const segments = parseMessageContent('')
    expect(segments).toEqual([{ type: 'text', content: '' }])
  })
})

describe('isImageUrl', () => {
  it('detects common image extensions', () => {
    expect(isImageUrl('https://example.com/photo.jpg')).toBe(true)
    expect(isImageUrl('https://example.com/photo.jpeg')).toBe(true)
    expect(isImageUrl('https://example.com/photo.png')).toBe(true)
    expect(isImageUrl('https://example.com/photo.gif')).toBe(true)
    expect(isImageUrl('https://example.com/photo.webp')).toBe(true)
    expect(isImageUrl('https://example.com/photo.svg')).toBe(true)
  })

  it('handles URLs with query parameters', () => {
    expect(isImageUrl('https://example.com/photo.png?width=200')).toBe(true)
  })

  it('returns false for non-image URLs', () => {
    expect(isImageUrl('https://example.com/page.html')).toBe(false)
    expect(isImageUrl('https://example.com/file.pdf')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isImageUrl('https://example.com/photo.PNG')).toBe(true)
    expect(isImageUrl('https://example.com/photo.JPG')).toBe(true)
  })
})
