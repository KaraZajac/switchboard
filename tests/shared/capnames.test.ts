import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CAP_NAMES, CAP_ALIASES, negotiatedAs, hasCapability } from '@shared/capnames'
import { REQUESTED_CAPS } from '@shared/constants'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/capabilities.json'), 'utf8')
) as {
  aliases: {
    name: string
    feature: keyof typeof CAP_NAMES
    offered: string[]
    negotiatedAs: string | null
  }[]
}

describe('a capability that goes by more than one name', () => {
  for (const c of corpus.aliases) {
    it(c.name, () => {
      expect(negotiatedAs(c.offered, CAP_NAMES[c.feature])).toBe(c.negotiatedAs)
      expect(hasCapability(c.offered, CAP_NAMES[c.feature])).toBe(c.negotiatedAs !== null)
    })
  }

  it('asks for every spelling it knows', () => {
    /*
     * Asking for a name the server did not offer costs nothing — the request
     * is built from what CAP LS listed — and not asking costs the whole
     * feature, silently. soju offers `soju.im/webpush`; we asked for
     * `draft/webpush` alone, so push through a soju never worked.
     */
    for (const name of CAP_ALIASES) {
      expect(REQUESTED_CAPS as readonly string[], `${name} is never asked for`).toContain(name)
    }
  })
})
