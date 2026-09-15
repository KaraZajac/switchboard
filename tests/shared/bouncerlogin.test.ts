import { describe, it, expect } from 'vitest'
import { parseLogin, formatLogin, findNetwork, loginInPassword } from '@shared/bouncerlogin'
import fixture from '../fixtures/bouncerlogin.json'

describe('the name a client logs into a bouncer with', () => {
  for (const login of fixture.logins) {
    it(`reads ${JSON.stringify(login.raw)}`, () => {
      expect(parseLogin(login.raw)).toEqual({
        user: login.user,
        client: login.client,
        network: login.network
      })
    })
  }

  it('puts a login back together', () => {
    expect(formatLogin({ user: 'kara', client: 'laptop', network: 'netslum' })).toBe(
      'kara@laptop/netslum'
    )
    expect(formatLogin({ user: 'kara', client: null, network: 'netslum' })).toBe('kara/netslum')
    expect(formatLogin({ user: 'kara', client: null, network: null })).toBe('kara')
  })

  it('takes the client name from before the network, not after', () => {
    // `laptop/netslum` as a client name would bind nothing and be very hard to
    // see from the client end
    expect(parseLogin('kara@laptop/netslum').client).toBe('laptop')
  })
})

describe('finding the network somebody asked for', () => {
  const networks = [
    { id: 'a1b2', name: 'netslum' },
    { id: 'c3d4', name: 'd0ll' }
  ]
  const find = (wanted: string) =>
    findNetwork(
      networks,
      wanted,
      (n) => n.name,
      (n) => n.id
    )

  it('matches the id exactly', () => {
    expect(find('a1b2')?.name).toBe('netslum')
  })

  it('matches a name however it was typed', () => {
    expect(find('NetSlum')?.id).toBe('a1b2')
  })

  it('finds nothing rather than guessing between two of the same name', () => {
    const twins = [
      { id: 'a', name: 'work' },
      { id: 'b', name: 'Work' }
    ]
    expect(
      findNetwork(
        twins,
        'work',
        (n) => n.name,
        (n) => n.id
      )
    ).toBeNull()
  })

  it('prefers an id over a name that collides with it', () => {
    const odd = [
      { id: 'netslum', name: 'somewhere else' },
      { id: 'x', name: 'netslum' }
    ]
    expect(
      findNetwork(
        odd,
        'netslum',
        (n) => n.name,
        (n) => n.id
      )?.name
    ).toBe('somewhere else')
  })
})

describe('a login hidden in the password, which is how ZNC has always taken one', () => {
  for (const c of fixture.embedded) {
    it(c.name, () => {
      const found = loginInPassword(c.raw)
      if (c.user === null) {
        expect(found).toBeNull()
        return
      }
      expect(found).toEqual({
        login: { user: c.user, client: c.client, network: c.network },
        password: c.password
      })
    })
  }
})
