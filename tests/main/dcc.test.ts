import { describe, it, expect, afterEach } from 'vitest'
import * as net from 'net'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatDcc } from '../../src/shared/dcc'

/**
 * Moving a file, over real sockets.
 *
 * The failures worth guarding are all about a peer behaving badly: one that
 * sends more than it said, one that hangs up in the middle, one that never
 * connects. None of those can be produced with a mock that behaves.
 */

const { noteDccOffer, acceptTransfer, declineTransfer, listTransfers, onTransferChange, offerFile } =
  await import('../../src/main/irc/features/dcc')

const servers: net.Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  onTransferChange(() => {})
})

/** A sender that streams whatever it is told to */
function sender(body: Buffer, options: { hangUpAfter?: number } = {}): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      if (options.hangUpAfter !== undefined) {
        socket.write(body.subarray(0, options.hangUpAfter))
        socket.end()
        return
      }
      socket.write(body)
      socket.end()
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })
}

/** Wait for a transfer to reach a state it will not leave */
function settled(id: string): Promise<string> {
  return new Promise((resolve) => {
    onTransferChange((transfer) => {
      if (transfer.id !== id) return
      if (['done', 'failed', 'declined'].includes(transfer.state)) resolve(transfer.state)
    })
  })
}

const offer = (port: number, size: number, filename = 'notes.txt'): string =>
  formatDcc({ kind: 'send', filename, address: '127.0.0.1', port, size })

describe('receiving a file', () => {
  it('writes what was sent, where it was told to', async () => {
    const body = Buffer.from('the whole file, exactly')
    const port = await sender(body)

    const transfer = noteDccOffer('srv', 'alice', offer(port, body.length))!
    expect(transfer.state).toBe('offered')

    const directory = mkdtempSync(join(tmpdir(), 'dcc-'))
    const done = settled(transfer.id)
    acceptTransfer(transfer.id, directory)

    expect(await done).toBe('done')
    expect(readFileSync(join(directory, 'notes.txt'), 'utf8')).toBe(body.toString())
  })

  /**
   * The failure that matters. A sender who says one number and streams another
   * would otherwise write until the disk fills.
   */
  it('stops at the size the sender claimed', async () => {
    const claimed = 10
    const body = Buffer.alloc(100_000, 0x41)
    const port = await sender(body)

    noteDccOffer('srv', 'alice', offer(port, claimed))
    const transfer = listTransfers().at(-1)!

    const directory = mkdtempSync(join(tmpdir(), 'dcc-'))
    const done = settled(transfer.id)
    acceptTransfer(transfer.id, directory)

    expect(await done).toBe('done')
    expect(readFileSync(join(directory, 'notes.txt')).length).toBe(claimed)
  })

  it('says so when the sender hangs up early', async () => {
    const body = Buffer.alloc(1000, 0x41)
    const port = await sender(body, { hangUpAfter: 100 })

    noteDccOffer('srv', 'alice', offer(port, body.length))
    const transfer = listTransfers().at(-1)!

    const directory = mkdtempSync(join(tmpdir(), 'dcc-'))
    const done = settled(transfer.id)
    acceptTransfer(transfer.id, directory)

    expect(await done).toBe('failed')
  })

  it('fails rather than hanging when nobody is listening', async () => {
    // A port nothing is on. Closing a server we just opened is the reliable
    // way to get one that is certainly free and certainly refusing.
    const port = await sender(Buffer.alloc(0))
    servers.splice(0).forEach((server) => server.close())
    await new Promise((r) => setTimeout(r, 50))

    noteDccOffer('srv', 'alice', offer(port, 10))
    const transfer = listTransfers().at(-1)!

    const directory = mkdtempSync(join(tmpdir(), 'dcc-'))
    const done = settled(transfer.id)
    acceptTransfer(transfer.id, directory)

    expect(await done).toBe('failed')
  })

  /**
   * The name came from whoever sent it. A transfer that writes outside the
   * folder somebody chose is the whole reason this feature is dangerous.
   */
  it('never writes outside the chosen folder', async () => {
    const body = Buffer.from('x')
    const port = await sender(body)

    noteDccOffer('srv', 'alice', offer(port, body.length, '../escaped.txt'))
    const transfer = listTransfers().at(-1)!
    expect(transfer.filename).toBe('escaped.txt')

    const directory = mkdtempSync(join(tmpdir(), 'dcc-'))
    const done = settled(transfer.id)
    acceptTransfer(transfer.id, directory)
    await done

    expect(existsSync(join(directory, 'escaped.txt'))).toBe(true)
    expect(existsSync(join(directory, '..', 'escaped.txt'))).toBe(false)
  })

  it('records an offer without connecting to anything', () => {
    const before = listTransfers().length
    // A port nothing could be on, so connecting would certainly fail
    expect(noteDccOffer('srv', 'alice', offer(1, 10))).not.toBe(null)
    expect(listTransfers().length).toBe(before + 1)
    expect(listTransfers().at(-1)!.state).toBe('offered')
  })

  it('takes a refusal off the list', () => {
    noteDccOffer('srv', 'alice', offer(1, 10))
    const transfer = listTransfers().at(-1)!
    declineTransfer(transfer.id)
    expect(listTransfers().some((one) => one.id === transfer.id)).toBe(false)
  })

  it('ignores what is not an offer', () => {
    expect(noteDccOffer('srv', 'alice', 'VERSION')).toBe(null)
  })

  /** Reverse DCC asks us to listen, which this does not do — and does not pretend to */
  it('does not record a reverse offer it cannot honour', () => {
    const before = listTransfers().length
    expect(noteDccOffer('srv', 'alice', 'DCC SEND x 2130706433 0 10 4711')).toBe(null)
    expect(listTransfers().length).toBe(before)
  })
})

describe('offering a file', () => {
  it('listens, and streams to whoever connects', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dcc-')), 'outgoing.txt')
    writeFileSync(path, 'this is going out')

    const { line, transfer } = await offerFile('srv', 'bob', path, '127.0.0.1')
    expect(line).toMatch(/^DCC SEND outgoing\.txt 2130706433 \d+ 17$/)

    const done = settled(transfer.id)
    const received = await new Promise<string>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: transfer.offer.port }, () => {
        let body = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk) => (body += chunk))
        socket.on('end', () => resolve(body))
      })
    })

    expect(received).toBe('this is going out')
    expect(await done).toBe('done')
  })

  it('refuses a file it cannot read', async () => {
    await expect(offerFile('srv', 'bob', '/definitely/not/here', '127.0.0.1')).rejects.toThrow()
  })
})
