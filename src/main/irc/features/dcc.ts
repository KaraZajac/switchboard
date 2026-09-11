import * as net from 'net'
import { createWriteStream, createReadStream, statSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import {
  parseDcc,
  formatDcc,
  safeFilename,
  isReverse,
  type DccTransfer as Transfer
} from '@shared/dcc'

export type { DccTransfer as Transfer } from '@shared/dcc'

/**
 * Moving a file, once somebody has agreed to.
 *
 * `@shared/dcc` reads and writes the line; this opens the socket. Kept apart
 * because the line is the same on both clients and the socket is not — and
 * because everything here is a decision about somebody else's computer
 * connecting to this one, which deserves to be in one place where it can be
 * read.
 *
 * Nothing is automatic. An offer arrives, it is shown, and a transfer starts
 * only when a person says so. Auto-accepting a DCC is how the protocol got its
 * reputation, and no setting here turns that on.
 */

type Watcher = (transfer: Transfer) => void

const transfers = new Map<string, Transfer>()
let watch: Watcher = () => {}

/** Tell the app when a transfer changes */
export function onTransferChange(watcher: Watcher): void {
  watch = watcher
}

export function listTransfers(): Transfer[] {
  return [...transfers.values()]
}

/**
 * Somebody sent us a DCC line.
 *
 * Returns the transfer when one was recorded, so the caller can open the
 * conversation it belongs to — an offer from somebody you have never messaged
 * otherwise has nowhere to appear. Null covers both "not a DCC line" and "one
 * we do not act on", which the caller treats the same way.
 */
export function noteDccOffer(
  serverId: string,
  peer: string,
  body: string
): Transfer | null {
  const offer = parseDcc(body)
  if (!offer) return null

  // Only SEND is acted on. CHAT is a second conversation window, RESUME and
  // ACCEPT belong to a transfer already under way, and pretending to handle
  // one of those would be worse than ignoring it.
  if (offer.kind !== 'send') return null

  // Reverse DCC asks us to open a listening socket for them. Not offered:
  // every other machine on the network would have to be able to reach this
  // one, which for most people it cannot, and the failure is a transfer that
  // hangs rather than one that is refused.
  if (isReverse(offer)) return null

  const transfer: Transfer = {
    id: uuid(),
    peer,
    serverId,
    filename: safeFilename(offer.filename),
    size: offer.size,
    transferred: 0,
    direction: 'incoming',
    state: 'offered',
    offer
  }

  transfers.set(transfer.id, transfer)
  watch(transfer)
  return transfer
}

/** Refuse one. Nothing is sent — the sender's own timeout ends it. */
export function declineTransfer(id: string): void {
  const transfer = transfers.get(id)
  if (!transfer) return
  transfer.state = 'declined'
  watch(transfer)
  transfers.delete(id)
}

/**
 * Accept an offer and write the file where the person chose.
 *
 * The size the sender claimed is not trusted for anything but a progress bar.
 * A sender who says one number and streams another gets stopped at the number
 * they said, because a transfer that keeps writing until the disk fills is the
 * failure that matters.
 */
export function acceptTransfer(id: string, directory: string): void {
  const transfer = transfers.get(id)
  if (!transfer || transfer.state !== 'offered') return

  const path = join(directory, transfer.filename)
  transfer.path = path
  transfer.state = 'active'
  watch(transfer)

  const file = createWriteStream(path)
  const socket = net.connect({ host: transfer.offer.address, port: transfer.offer.port })

  const fail = (reason: string): void => {
    transfer.state = 'failed'
    transfer.error = reason
    watch(transfer)
    socket.destroy()
    file.end()
  }

  // A sender who never connects, or one that stalls, must not leave a
  // half-written file and a row that says "active" for good.
  socket.setTimeout(60_000, () => fail('The sender stopped responding'))

  socket.on('data', (chunk: Buffer) => {
    const room = transfer.size > 0 ? transfer.size - transfer.transferred : chunk.length
    if (room <= 0) {
      // They said how big it was and have gone past it
      socket.end()
      return
    }

    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk
    file.write(piece)
    transfer.transferred += piece.length

    // DCC acknowledges with the running total as a big-endian 32-bit count.
    // Some senders wait for it before sending more, so leaving it out is a
    // transfer that stops after one window and never says why.
    const ack = Buffer.alloc(4)
    ack.writeUInt32BE(transfer.transferred >>> 0, 0)
    socket.write(ack)

    watch(transfer)

    if (transfer.size > 0 && transfer.transferred >= transfer.size) socket.end()
  })

  socket.on('error', (err: Error) => fail(err.message))

  socket.on('close', () => {
    file.end()
    if (transfer.state !== 'active') return

    // A sender that hung up early left a file that is not the file
    if (transfer.size > 0 && transfer.transferred < transfer.size) {
      fail('The sender hung up before the file was finished')
      return
    }
    transfer.state = 'done'
    watch(transfer)
  })
}

/**
 * Offer a file to somebody.
 *
 * Listens on a port the operating system picks and tells them where. Returns
 * the line to send, or null when the file cannot be read — which is worth
 * knowing before announcing a transfer that cannot happen.
 *
 * The address is this machine's as it appears on the local network, which is
 * the honest thing to send and is wrong behind a NAT. There is no way to know
 * the outside address without asking something, and guessing would be worse
 * than a transfer the recipient can see fail.
 */
export function offerFile(
  serverId: string,
  peer: string,
  path: string,
  localAddress: string
): Promise<{ line: string; transfer: Transfer }> {
  return new Promise((resolve, reject) => {
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      reject(new Error('That file could not be read'))
      return
    }

    const filename = path.split(/[/\\]/).pop() || 'file'
    const transfer: Transfer = {
      id: uuid(),
      peer,
      serverId,
      filename,
      path,
      size,
      transferred: 0,
      direction: 'outgoing',
      state: 'offered',
      offer: { kind: 'send' as const, filename, address: localAddress, port: 0, size }
    }

    const server = net.createServer((socket) => {
      // One recipient. A second connection to the same offer is not the person
      // it was made to.
      server.close()
      clearTimeout(giveUp)

      transfer.state = 'active'
      watch(transfer)

      const reading = createReadStream(path)
      reading.pipe(socket)

      reading.on('data', (chunk) => {
        transfer.transferred += chunk.length
        watch(transfer)
      })

      socket.on('error', () => {
        transfer.state = 'failed'
        transfer.error = 'The connection failed'
        watch(transfer)
        reading.destroy()
      })

      socket.on('close', () => {
        if (transfer.state !== 'active') return
        transfer.state = transfer.transferred >= size ? 'done' : 'failed'
        if (transfer.state === 'failed') transfer.error = 'They hung up early'
        watch(transfer)
      })
    })

    // Nobody came. Left open, this is a listening socket for the life of the
    // process, for a file nobody is collecting.
    const giveUp = setTimeout(() => {
      if (transfer.state !== 'offered') return
      server.close()
      transfer.state = 'failed'
      transfer.error = 'Nobody collected it'
      watch(transfer)
    }, 300_000)
    giveUp.unref?.()

    server.on('error', (err) => {
      clearTimeout(giveUp)
      reject(err)
    })

    // The port the operating system picked is not known until now, and it is
    // half of what the offer says — so the line cannot be written before this.
    server.listen(0, () => {
      transfer.offer = { ...transfer.offer, port: (server.address() as net.AddressInfo).port }
      transfers.set(transfer.id, transfer)
      watch(transfer)
      resolve({ line: formatDcc(transfer.offer), transfer })
    })
  })
}

