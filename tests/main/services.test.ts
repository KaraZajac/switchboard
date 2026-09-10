import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isServiceNick } from '@shared/constants'
import { asksForIdentification, confirmsIdentification } from '@shared/services'

/**
 * Knowing NickServ when you see it.
 *
 * The lines are real ones, from the three services packages most of IRC runs.
 * Shared with the Android suite, because both clients offer the login screen at
 * the same moment or they are two clients.
 */
const corpus: {
  nicks: { name: string; nick: string; isServices: boolean }[]
  prompts: { name: string; text: string; asks: boolean; confirms: boolean }[]
} = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/services.json'), 'utf8'))

describe('who speaks for the network', () => {
  for (const c of corpus.nicks) {
    it(c.name, () => expect(isServiceNick(c.nick)).toBe(c.isServices))
  }
})

describe('what services are asking for', () => {
  for (const c of corpus.prompts) {
    it(c.name, () => {
      expect(asksForIdentification(c.text)).toBe(c.asks)
      expect(confirmsIdentification(c.text)).toBe(c.confirms)
    })
  }
})
