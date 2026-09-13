import { describe, it, expect } from 'vitest'
import { vapidKeyFrom } from '../../src/main/irc/features/webpush'

/**
 * Where the server's VAPID key is.
 *
 * draft/webpush puts it in the `VAPID` ISUPPORT token, which is where rIRCd
 * advertises it. An earlier draft carried it in the capability's value, and
 * a server still doing that is not a reason to refuse to subscribe.
 */
describe('the VAPID key', () => {
  it('is the ISUPPORT token', () => {
    expect(vapidKeyFrom({ VAPID: 'BNcRd…key' })).toBe('BNcRd…key')
  })

  it('is read from the capability value when there is no token', () => {
    expect(vapidKeyFrom({}, 'vapid=BOld…key')).toBe('BOld…key')
    expect(vapidKeyFrom({}, 'ttl=3600,vapid=BOld…key')).toBe('BOld…key')
  })

  it('prefers the token when both are given', () => {
    expect(vapidKeyFrom({ VAPID: 'BNew' }, 'vapid=BOld')).toBe('BNew')
  })

  it('is nothing when neither says', () => {
    expect(vapidKeyFrom({})).toBeNull()
    expect(vapidKeyFrom({ VAPID: true })).toBeNull()
    expect(vapidKeyFrom({}, 'ttl=3600')).toBeNull()
    expect(vapidKeyFrom({}, 'vapid=')).toBeNull()
  })
})
