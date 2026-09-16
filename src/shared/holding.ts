/**
 * Which thing is holding the connections, in one word.
 *
 * Both clients show this and both had their own idea of it, which is how a
 * phone came to say `SERVER` for the same arrangement a desktop called nothing
 * at all. It is one sentence about one fact, so it is decided once.
 *
 * The phone also said it twice: a green banner reading "This phone is holding
 * the connections" sat above a pill reading `LIVE`. A banner that says
 * everything is normal is a banner people learn to skip, and then miss when it
 * stops being true — which is the reasoning already written beside it, applied
 * to every case but that one.
 */

export type Holder =
  /** This device, straight to the networks */
  | 'live'
  /** A bouncer — an always-on Switchboard, a soju, a ZNC */
  | 'bouncer'
  /** Another Switchboard desktop, over the link */
  | 'desktop'
  /** Dialling */
  | 'connecting'
  /** Dialling, and there is a device to take over from */
  | 'taking-over'
  | 'offline'

export interface HoldingNow {
  /** Whether this device is holding rather than following */
  holding: boolean
  /** Whether it is on its way there */
  connecting: boolean
  /**
   * Whether another device is holding them *right now*.
   *
   * Separate from [everPaired] on purpose. One name for both was how a phone
   * came to say `TAKING OVER` beside a desktop that was switched off: the two
   * questions — is somebody else holding this, and is this device part of a
   * pair at all — have different answers most of the time, and the pill needs
   * each of them for a different word.
   */
  peerHolding: boolean
  /** When following: whether the peer we follow is an always-on Switchboard */
  followingAlwaysOn: boolean
  /**
   * Whether there is another device in the picture at all, holding or not.
   *
   * Only ever used to choose between `taking-over` and `connecting`: on a
   * device that has never been paired, "taking over" names something the
   * person has no idea about and cannot act on, while a socket dialling has a
   * perfectly ordinary name.
   */
  everPaired: boolean
  /**
   * When holding: whether every network it holds is reached through a bouncer.
   *
   * All rather than any, because the word has to be true of the whole picture.
   * With one network through a soju and two straight to the server, the honest
   * word is `live` — this device is the one on those two.
   */
  allThroughBouncer: boolean
}

export function whoIsHolding(now: HoldingNow): Holder {
  if (now.holding) return now.allThroughBouncer ? 'bouncer' : 'live'
  if (now.peerHolding && !now.connecting) {
    return now.followingAlwaysOn ? 'bouncer' : 'desktop'
  }
  if (now.connecting) return now.everPaired ? 'taking-over' : 'connecting'
  return 'offline'
}

/**
 * The word itself.
 *
 * Kept beside the decision so the two clients cannot drift apart on the
 * spelling, which is the half a person actually sees.
 */
export function holdingLabel(holder: Holder): string {
  switch (holder) {
    case 'live':
      return 'LIVE'
    case 'bouncer':
      return 'BOUNCER'
    case 'desktop':
      return 'DESKTOP'
    case 'connecting':
      return 'CONNECTING'
    case 'taking-over':
      return 'TAKING OVER'
    case 'offline':
      return 'OFFLINE'
  }
}

/**
 * What it means, for somewhere with room for a sentence.
 *
 * The pill is the whole of it in the header; a settings screen can afford to
 * say which thing, and that is where somebody goes when the word surprises
 * them.
 */
export function holdingDetail(holder: Holder): string {
  switch (holder) {
    case 'live':
      return 'This device is connected to the networks'
    case 'bouncer':
      return 'A bouncer is holding the connections'
    case 'desktop':
      return 'Another device is holding the connections'
    case 'connecting':
      return 'Connecting'
    case 'taking-over':
      return 'Taking over from the other device'
    case 'offline':
      return 'Not connected'
  }
}
