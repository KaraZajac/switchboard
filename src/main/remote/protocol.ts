import { randomInt, timingSafeEqual } from 'crypto'
/**
 * Wire format for the link between the desktop core and a paired device.
 *
 * Newline-delimited JSON over one QUIC bidirectional stream. The vocabulary is
 * deliberately the same as the desktop UI's: `call` carries an IPC channel name
 * and its arguments, `event` carries what the renderer would have received. A
 * remote client is a second renderer, so it should not need a second protocol.
 */

export const REMOTE_ALPN = 'switchboard/remote/0'
export const PROTOCOL_VERSION = 1

/**
 * Frames either side may send.
 *
 * These are the peer-to-peer half of the protocol: which device is holding the
 * IRC connections, and keeping the shared vault in step. Everything else is
 * still a follower asking the primary to do something.
 */
export type PeerFrame =
  | {
      t: 'heartbeat'
      role: 'primary' | 'follower'
      priority: number
      since: string | null
      vaultVersion: number
    }
  | { t: 'claim'; priority: number }
  | { t: 'yielded' }
  /**
   * "I am going away."
   *
   * Sent when a device shuts down on purpose. Without it the other side waits
   * out the heartbeat timeout before concluding anything — sixteen seconds of
   * a user's messages going nowhere, every time they close the app.
   */
  | { t: 'goodbye' }
  /** "I have vault vN" — the other side asks for it if theirs is older */
  | {
      t: 'vault-offer'
      version: number
      /**
       * Sealed when, so the receiver can run the same rule the adopter runs.
       *
       * Optional because a peer on an older build does not send it — and
       * without it the rule falls back to comparing versions alone, which is
       * exactly what that peer already does.
       */
      updatedAt?: string
    }
  | { t: 'vault-request' }
  | { t: 'vault-payload'; envelope: unknown }

/** Device → desktop */
export type ClientFrame =
  | { t: 'hello'; v: number; name: string; pairingCode?: string }
  | { t: 'call'; id: number; channel: string; args: unknown[] }
  | PeerFrame

/** Desktop → device */
export type ServerFrame =
  | { t: 'welcome'; v: number; name: string; paired: true }
  | { t: 'denied'; reason: string }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; channel: string; data: unknown }
  | PeerFrame

/** Frames that belong to the session/vault layer rather than the call layer */
export function isPeerFrame(frame: { t: string }): frame is PeerFrame {
  return (
    frame.t === 'heartbeat' ||
    frame.t === 'claim' ||
    frame.t === 'yielded' ||
    frame.t === 'goodbye' ||
    frame.t === 'vault-offer' ||
    frame.t === 'vault-request' ||
    frame.t === 'vault-payload'
  )
}

export function encodeFrame(frame: ClientFrame | ServerFrame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(frame) + '\n')
}

/**
 * Accumulates bytes and yields whole frames.
 *
 * QUIC gives an ordered byte stream, not messages, so a read can end mid-frame
 * or contain several — both of which happen as soon as events start flowing.
 */
export class FrameDecoder {
  private buffer = ''
  private readonly decoder = new TextDecoder()

  constructor(private readonly maxFrameBytes = 8 * 1024 * 1024) {}

  push(chunk: Uint8Array | number[]): unknown[] {
    const bytes = chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk)
    this.buffer += this.decoder.decode(bytes, { stream: true })

    if (this.buffer.length > this.maxFrameBytes) {
      this.buffer = ''
      throw new Error('Remote frame exceeded the size limit')
    }

    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    const frames: unknown[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        frames.push(JSON.parse(line))
      } catch {
        throw new Error('Malformed frame on the remote link')
      }
    }
    return frames
  }
}

/**
 * A short human-checkable pairing code, as shown next to the QR.
 *
 * From the system's random source, not `Math.random`. V8's is xorshift128+ —
 * fast, evenly distributed, and recoverable: given a few outputs of the same
 * stream its internal state can be solved for and every later value predicted.
 * That is fine for picking a colour and not for the one secret standing
 * between a stranger with your pairing ticket and your IRC connection.
 *
 * `randomInt` is uniform over the range rather than modulo-biased, which
 * matters less at a million than it would at a smaller space, and costs
 * nothing to get right.
 */
export function generatePairingCode(): string {
  // Digits only: it gets read aloud and typed on a phone keyboard
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * How many wrong codes end the window.
 *
 * Six digits is a million, and a wrong guess only cost a reconnect — so five
 * minutes of trying was five minutes of free attempts against the one secret
 * standing between somebody holding your ticket and your IRC connection.
 * Nobody types it wrong five times; a program does.
 *
 * Counted across devices rather than per connection, because "open another
 * connection" is precisely what a guess costs.
 */
export const PAIRING_MAX_WRONG = 5

/**
 * One try at the code, and what it costs.
 *
 * Compared in constant time, because a check that returns sooner for a longer
 * shared prefix hands the code over a digit at a time.
 *
 * Lives here rather than beside the handshake because the handshake pulls in
 * the iroh endpoint, and this is the part worth testing.
 */
export function pairingAttempt(
  session: { code: string; wrong: number },
  given: string | undefined
): 'ok' | 'wrong' | 'exhausted' {
  const offered = Buffer.from(given ?? '')
  const expected = Buffer.from(session.code)

  if (offered.length === expected.length && timingSafeEqual(offered, expected)) return 'ok'

  session.wrong++
  // Not "slow down" — closed. A window that reopens on a timer is a window an
  // unattended program waits out, and the person pairing is standing in front
  // of both screens and can press the button again.
  return session.wrong >= PAIRING_MAX_WRONG ? 'exhausted' : 'wrong'
}
