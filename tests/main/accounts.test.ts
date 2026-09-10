import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { accountAbilities, bestSaslMechanism, canShareConnection } from '@shared/accounts'

/**
 * What a network will let you do about an account.
 *
 * Shared with the Android suite, because both clients put the same form in
 * front of the user and both have to fill it in from the same string.
 */
interface Case {
  name: string
  values: Record<string, string>
  canRegister: boolean
  emailRequired: boolean
  minPasswordLength: number | null
  beforeConnect: boolean
  saslMechanisms: string[]
  bestMechanism: string | null
}

interface SharingCase {
  name: string
  config: { saslMechanism: string | null; saslPassword: string | null }
  canShare: boolean
}

const corpus: { cases: Case[]; sharing: SharingCase[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/accounts.json'), 'utf8')
)

describe('reading what a network can do about accounts', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const abilities = accountAbilities(c.values)

      expect(abilities.canRegister).toBe(c.canRegister)
      expect(abilities.emailRequired).toBe(c.emailRequired)
      expect(abilities.minPasswordLength).toBe(c.minPasswordLength)
      expect(abilities.beforeConnect).toBe(c.beforeConnect)
      expect(abilities.saslMechanisms).toEqual(c.saslMechanisms)
      expect(bestSaslMechanism(abilities.saslMechanisms)).toBe(c.bestMechanism)
    })
  }
})

/**
 * Whether both devices can be on one network at the same time.
 *
 * The precondition, not the permission: the network gives its answer by
 * letting the second connection keep the nick or not. Shared with the Android
 * suite, because a device that decides differently either sits out a network it
 * could have joined or turns up in the channel twice under two names.
 */
describe('sharing a network between two devices', () => {
  for (const c of corpus.sharing) {
    it(c.name, () => expect(canShareConnection(c.config)).toBe(c.canShare))
  }
})
