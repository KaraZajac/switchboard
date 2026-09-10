import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  accountAbilities,
  accountView,
  bestSaslMechanism,
  canShareConnection
} from '@shared/accounts'

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

interface ViewCase {
  name: string
  connected: boolean
  account: string | null
  remembered: boolean
  canRegister: boolean
  view: string
}

const corpus: { cases: Case[]; sharing: SharingCase[]; views: ViewCase[] } = JSON.parse(
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

/**
 * Which half of the account screen to show.
 *
 * The order matters more than any state individually: a network that has not
 * been reached cannot be asked what it can do, and somebody already logged in
 * should not be offered a form to register the nick they are logged in as.
 */
describe('choosing what the account screen offers', () => {
  const state = (over: Partial<Parameters<typeof accountView>[0]> = {}) =>
    accountView({
      connected: true,
      account: null,
      remembered: false,
      canRegister: false,
      ...over
    })

  it('says nothing about a network it has not reached', () => {
    // Even one that could register, because that is read off a connection
    expect(state({ connected: false, canRegister: true })).toBe('offline')
  })

  it('offers to remember an account you are logged in to', () => {
    expect(state({ account: 'kara' })).toBe('remember')
  })

  it('and says so when it already has', () => {
    expect(state({ account: 'kara', remembered: true })).toBe('settled')
  })

  /** Being logged in settles it, whatever else the network can do */
  it('never offers to register a nick you are already logged in as', () => {
    expect(state({ account: 'kara', canRegister: true })).toBe('remember')
  })

  it('offers registration where the network does it', () => {
    expect(state({ canRegister: true })).toBe('register')
  })

  it('and NickServ where it does not', () => {
    expect(state()).toBe('nickserv')
  })
})

/**
 * Shared with the Android suite, because both clients render the same four
 * states and a screen that picks a different one is a different client.
 */
describe('the account screen’s four states, as both clients see them', () => {
  for (const c of corpus.views) {
    it(c.name, () => expect(accountView(c)).toBe(c.view))
  }
})
