import { describe, it, expect, beforeEach } from 'vitest'
import { useChannelStore } from '../../src/renderer/stores/channelStore'

const SERVER = 'server-1'

const channel = (name: string) =>
  (useChannelStore.getState().channels[SERVER] || []).find((ch) => ch.name === name)

beforeEach(() => {
  useChannelStore.setState({
    channels: {},
    mutedChannels: {},
    activeChannel: {},
    readMarkers: {}
  })
})

describe('channel mute state', () => {
  it('mutes and unmutes a channel', () => {
    const store = useChannelStore.getState()
    store.addChannel(SERVER, '#general')

    store.toggleMute(SERVER, '#general')
    expect(channel('#general')?.muted).toBe(true)
    expect(useChannelStore.getState().mutedChannels[`${SERVER}:#general`]).toBe(0)

    useChannelStore.getState().toggleMute(SERVER, '#general')
    expect(channel('#general')?.muted).toBe(false)
    expect(useChannelStore.getState().mutedChannels).toEqual({})
  })

  it('applies a saved mute to a channel joined later', () => {
    useChannelStore.getState().hydrateMutes({ [`${SERVER}:#general`]: 0 })
    useChannelStore.getState().addChannel(SERVER, '#General')

    expect(channel('#General')?.muted).toBe(true)
  })

  it('drops mutes that expired while the app was closed', () => {
    useChannelStore.getState().hydrateMutes({
      [`${SERVER}:#stale`]: Date.now() - 1000,
      [`${SERVER}:#live`]: Date.now() + 60_000
    })

    const { mutedChannels } = useChannelStore.getState()
    expect(mutedChannels[`${SERVER}:#stale`]).toBeUndefined()
    expect(mutedChannels[`${SERVER}:#live`]).toBeDefined()
  })

  it('can re-mute a channel whose timed mute has run out', () => {
    useChannelStore.getState().addChannel(SERVER, '#general')
    // A mute that has already expired, as left behind by a timed mute
    useChannelStore.setState({ mutedChannels: { [`${SERVER}:#general`]: Date.now() - 1000 } })

    useChannelStore.getState().toggleMute(SERVER, '#general')

    expect(channel('#general')?.muted).toBe(true)
    expect(useChannelStore.getState().mutedChannels[`${SERVER}:#general`]).toBe(0)
  })

  it('records a timed mute with its expiry', () => {
    useChannelStore.getState().addChannel(SERVER, '#general')
    useChannelStore.getState().toggleMute(SERVER, '#general', 60_000)

    const muteUntil = useChannelStore.getState().mutedChannels[`${SERVER}:#general`]
    expect(muteUntil).toBeGreaterThan(Date.now())
    expect(channel('#general')?.muteUntil).toBe(muteUntil)
  })
})
