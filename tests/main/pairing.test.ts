import { describe, it, expect } from 'vitest'
import { encodePairingUri, parsePairingInput } from '@shared/pairing'

/**
 * What the phone scans.
 *
 * The Android client parses exactly this, so the shapes here are the contract
 * between the two. A ticket that round-trips wrongly is a pairing that fails
 * with no explanation anyone can act on.
 */
describe('the pairing payload', () => {
  it('round-trips a ticket and a code', () => {
    const uri = encodePairingUri('endpointabc123', '482915')
    expect(parsePairingInput(uri)).toEqual({ ticket: 'endpointabc123', code: '482915' })
  })

  it('round-trips a ticket with no code', () => {
    const uri = encodePairingUri('endpointabc123', null)
    expect(parsePairingInput(uri)).toEqual({ ticket: 'endpointabc123', code: null })
  })

  it('still accepts a bare ticket, which is what people paste', () => {
    expect(parsePairingInput('endpointabc123')).toEqual({
      ticket: 'endpointabc123',
      code: null
    })
  })

  it('trims what came off a clipboard', () => {
    expect(parsePairingInput('  endpointabc123\n')).toEqual({
      ticket: 'endpointabc123',
      code: null
    })
  })

  it('refuses a sentence, rather than pairing on nonsense', () => {
    expect(parsePairingInput('scan the code on your desktop')).toBeNull()
    expect(parsePairingInput('')).toBeNull()
    expect(parsePairingInput('   ')).toBeNull()
  })

  it('refuses a pairing URI with no ticket in it', () => {
    expect(parsePairingInput('switchboard://pair?code=482915')).toBeNull()
    expect(parsePairingInput('switchboard://pair')).toBeNull()
  })

  it('survives a ticket with URL-significant characters', () => {
    const awkward = 'endpoint+abc/123=xyz&more'
    const uri = encodePairingUri(awkward, '000001')
    expect(parsePairingInput(uri)).toEqual({ ticket: awkward, code: '000001' })
  })

  it('is not fooled by another app’s link', () => {
    expect(parsePairingInput('https://example.com/pair?ticket=abc')).toBeNull()
  })
})
