import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { redactLine } from '@shared/redact'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/redact.json'), 'utf8')
) as { cases: { name: string; line: string; redacted: string }[] }

describe('taking the secret out of a line', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(redactLine(c.line)).toBe(c.redacted))
  }

  it('never leaves the password of a SASL PLAIN exchange in the output', () => {
    const secret = 'hunter2'
    const payload = Buffer.from(`kara\0kara\0${secret}`).toString('base64')
    expect(redactLine(`AUTHENTICATE ${payload}`)).not.toContain(payload)
  })

  it('keeps enough of the line to still be a wire log', () => {
    // A log with the command blanked out is not a log
    expect(redactLine('OPER kara hunter2')).toContain('OPER')
    expect(redactLine('OPER kara hunter2')).toContain('kara')
    expect(redactLine('OPER kara hunter2')).not.toContain('hunter2')
  })
})
