import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { saslPlan, saslAccount, type SaslConfig } from '@shared/saslplan'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/saslplan.json'), 'utf8')) as {
  cases: {
    name: string
    config: SaslConfig
    offered: string[] | null
    action: string
    mechanism?: string
    reason?: string
  }[]
  accounts: { name: string; username: string | null; nick: string; account: string }[]
}

/**
 * Whether to log in, how, and what to say when we cannot.
 *
 * The two clients disagreed quietly, in a way nothing on screen would explain:
 * one config logged in on the phone and sat there as a stranger on the desktop.
 */
describe('deciding how to log in', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const plan = saslPlan(c.config, c.offered)
      expect(plan.action).toBe(c.action)
      if (plan.action === 'authenticate') expect(plan.mechanism).toBe(c.mechanism)
      if (plan.action === 'refuse') expect(plan.reason).toBe(c.reason)
    })
  }

  /**
   * The failure that started this. Somebody fills in an account name and a
   * password and expects to be logged in — on both devices, not one.
   */
  it('logs in from a username and a password alone', () => {
    const plan = saslPlan(
      { mechanism: null, username: 'kara', password: 'hunter2', clientCert: null },
      ['PLAIN']
    )
    expect(plan).toEqual({ action: 'authenticate', mechanism: 'PLAIN' })
  })

  it('never refuses silently — every refusal says something', () => {
    for (const c of corpus.cases) {
      const plan = saslPlan(c.config, c.offered)
      if (plan.action === 'refuse') expect(plan.reason.length).toBeGreaterThan(20)
    }
  })
})

describe('who we log in as', () => {
  for (const c of corpus.accounts) {
    it(c.name, () => {
      const config: SaslConfig = {
        mechanism: null,
        username: c.username,
        password: 'x',
        clientCert: null
      }
      expect(saslAccount(config, c.nick)).toBe(c.account)
    })
  }
})
