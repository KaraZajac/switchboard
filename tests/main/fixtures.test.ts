import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMessage } from '../../src/main/irc/parser'
import { serializeMessage } from '../../src/main/irc/serializer'
import { openVault, deriveKeyFor, keyFingerprint, type VaultEnvelope } from '../../src/main/vault/crypto'

/**
 * The shared corpus, checked against the TypeScript implementation.
 *
 * The Android unit tests read these exact files (Gradle points at
 * ../../tests/fixtures), so a case that passes on both sides is a case where
 * the two clients genuinely agree. Nothing here is a copy — that is the point.
 */

const FIXTURES = join(__dirname, '../fixtures')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const corpus = read('irc-messages.json') as {
  cases: Array<{
    name: string
    raw: string
    parsed: {
      tags: Record<string, string | true>
      prefix: string | null
      nick: string | null
      command: string
      params: string[]
    }
  }>
  serialise: Array<{ name: string; command: string; params: string[]; line: string }>
}

describe('shared IRC corpus — parsing', () => {
  for (const testCase of corpus.cases) {
    it(testCase.name, () => {
      const message = parseMessage(testCase.raw)
      expect(message.tags).toEqual(testCase.parsed.tags)
      expect(message.prefix).toBe(testCase.parsed.prefix)
      expect(message.source?.nick ?? null).toBe(testCase.parsed.nick)
      expect(message.command).toBe(testCase.parsed.command)
      expect(message.params).toEqual(testCase.parsed.params)
    })
  }
})

describe('shared IRC corpus — serialising', () => {
  for (const testCase of corpus.serialise) {
    it(testCase.name, () => {
      expect(serializeMessage({ command: testCase.command, params: testCase.params })).toBe(
        testCase.line
      )
    })
  }
})

/**
 * The vault interop check.
 *
 * `vault-from-android.json` was sealed by the Kotlin code in
 * android/app/src/test. If this test fails, a phone can no longer open what the
 * desktop wrote, or the other way round — which is the failure that would strand
 * a user mid-handover with no way back.
 */
describe('vault interop', () => {
  const fixture = read('vault-from-android.json') as {
    passphrase: string
    payload: unknown
    fingerprint: string
    envelope: VaultEnvelope
  }

  it('opens a vault the Android client sealed', () => {
    const key = deriveKeyFor(fixture.envelope, fixture.passphrase)
    expect(openVault(fixture.envelope, key)).toEqual(fixture.payload)
  })

  it('derives the same key fingerprint the phone showed the user', () => {
    const key = deriveKeyFor(fixture.envelope, fixture.passphrase)
    expect(keyFingerprint(key)).toBe(fixture.fingerprint)
  })
})

/**
 * The themes, and the fixture the phone reads them from.
 *
 * `src/renderer/styles/globals.css` is where a theme is written; the fixture is
 * generated from it by `scripts/themes.py` and compiled into the Android app.
 * These check that nobody has edited one without regenerating the other, which
 * is how the two clients would quietly stop looking like the same product.
 */
describe('themes', () => {
  const css = readFileSync(join(__dirname, '../../src/renderer/styles/globals.css'), 'utf8')
  const fixture = read('themes.json') as {
    default: string
    themes: { id: string; label: string; roles: Record<string, string>; avatars: string[] }[]
  }

  /** The custom properties a [data-theme] block (or the bare :root) declares */
  function paletteFor(theme: string): Record<string, string> {
    const block =
      theme === fixture.default
        ? /Catppuccin Mocha.*?\n:root \{(.*?)\n\}/s.exec(css)
        : new RegExp(`\\[data-theme='${theme}'\\] \\{(.*?)\\n\\}`, 's').exec(css)

    expect(block, `no palette in globals.css for ${theme}`).not.toBeNull()

    const declared: Record<string, string> = {}
    for (const [, name, value] of block![1].matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
      declared[name] = value.trim().toLowerCase()
    }
    return declared
  }

  const ROLES: Record<string, string> = {
    crust: 'gray-950',
    mantle: 'gray-900',
    base: 'gray-800',
    surface0: 'gray-700',
    surface1: 'gray-600',
    muted: 'gray-500',
    overlay: 'gray-400',
    subtext: 'gray-300',
    text: 'gray-100',
    accent: 'indigo-500',
    accentSoft: 'indigo-400',
    good: 'green-400',
    warn: 'yellow-500',
    bad: 'red-400'
  }

  it('carries every theme the stylesheet defines', () => {
    const inCss = [...css.matchAll(/\[data-theme='([\w-]+)'\]/g)].map((m) => m[1])
    const named = new Set(fixture.themes.map((t) => t.id))

    // Every themed block, plus the default, which has no attribute of its own
    for (const theme of inCss) {
      expect(named.has(theme), `${theme} is in the CSS but not in themes.json`).toBe(true)
    }
    expect(named.has(fixture.default)).toBe(true)
    expect(fixture.themes.length).toBe(new Set(inCss).size + 1)
  })

  it('matches the stylesheet colour for colour', () => {
    for (const theme of fixture.themes) {
      const declared = paletteFor(theme.id)
      for (const [role, token] of Object.entries(ROLES)) {
        expect(theme.roles[role], `${theme.id} ${role} (--color-${token})`).toBe(declared[token])
      }
      // Two of the avatar colours are themed on the desktop, so they move
      expect(theme.avatars[5], `${theme.id} avatar green`).toBe(declared['green-600'])
      expect(theme.avatars[11], `${theme.id} avatar indigo`).toBe(declared['indigo-600'])
      expect(theme.avatars.length).toBe(17)
    }
  })

  it('gives every theme a name a person would recognise', () => {
    for (const theme of fixture.themes) {
      expect(theme.label.length, `${theme.id} needs a label`).toBeGreaterThan(0)
      expect(theme.label).not.toBe(theme.id)
    }
  })
})

