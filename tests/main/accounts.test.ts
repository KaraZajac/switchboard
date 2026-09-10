import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { accountAbilities, bestSaslMechanism } from '@shared/accounts'

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

const corpus: { cases: Case[] } = JSON.parse(
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
