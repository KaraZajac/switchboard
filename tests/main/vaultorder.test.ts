import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { shouldAdoptVault } from '@shared/vaultorder'

/**
 * Which of two sealed configs to keep.
 *
 * Shared with the Android suite: both devices have to answer this identically
 * or they trade vaults forever, or worse, one quietly rolls the other back.
 */
interface Case {
  name: string
  incoming: { version: number; updatedAt: string | null }
  current: { version: number; updatedAt: string | null } | null
  adopt: boolean
}

const corpus: { cases: Case[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/vault-order.json'), 'utf8')
)

describe('deciding which config is the one to keep', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(shouldAdoptVault(c.incoming, c.current)).toBe(c.adopt))
  }
})
