import { describe, it, expect } from 'vitest'
import { operFrom } from '../../src/shared/tags'

/**
 * draft/oper-tag.
 *
 * Someone claiming to be network staff in a DM is a common enough trick that
 * being able to tell is the whole point: this is the server saying it, and a
 * nick cannot. So the distinction that matters is between "the server says
 * yes" and "the server did not say" — never between yes and a missing name.
 */
describe('whether the server called the sender an operator', () => {
  it('gives the name when the server names one', () => {
    expect(operFrom({ 'draft/oper': 'kara' })).toBe('kara')
  })

  /** A valueless tag is still a yes, and must not read as an absence */
  it('is still a yes with no name on it', () => {
    expect(operFrom({ 'draft/oper': true })).toBe('')
    expect(operFrom({ 'draft/oper': true })).not.toBeNull()
  })

  it('is nothing at all when the tag is absent', () => {
    expect(operFrom({})).toBeNull()
    expect(operFrom({ account: 'kara', msgid: 'x' })).toBeNull()
  })

  /** The client tag is a different tag, and anyone can send one */
  it('does not take a client tag for the server saying so', () => {
    expect(operFrom({ '+draft/oper': 'liar' })).toBeNull()
  })
})
