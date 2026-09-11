import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageStore, SCROLLBACK_LIMIT } from '../../src/renderer/stores/messageStore'
import type { ChatMessage } from '../../src/shared/types/message'

/**
 * A ceiling on what one conversation keeps in memory.
 *
 * Nothing trimmed this at all, so a channel left open for a week grew until
 * the window did. Everything dropped is still in the database — scrolling up
 * is what brings it back.
 */
function message(n: number): ChatMessage {
  return {
    id: `m${n}`,
    serverId: 'srv',
    channel: '#chan',
    nick: 'kara',
    userHost: null,
    content: `line ${n}`,
    type: 'privmsg',
    tags: {},
    replyTo: null,
    timestamp: new Date(1700000000000 + n).toISOString(),
    account: null,
    pending: false,
    reactions: {}
  } as ChatMessage
}

describe('how much scrollback is kept', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} })
  })

  it('keeps everything below the ceiling', () => {
    const store = useMessageStore.getState()
    for (let n = 0; n < 50; n++) store.addMessage('srv', '#chan', message(n))
    expect(useMessageStore.getState().messages['srv:#chan']).toHaveLength(50)
  })

  it('drops the oldest once past it', () => {
    const store = useMessageStore.getState()
    for (let n = 0; n < SCROLLBACK_LIMIT + 100; n++) {
      store.addMessage('srv', '#chan', message(n))
    }

    const kept = useMessageStore.getState().messages['srv:#chan']
    expect(kept).toHaveLength(SCROLLBACK_LIMIT)
    // The newest survive; the first hundred are gone
    expect(kept[kept.length - 1].id).toBe(`m${SCROLLBACK_LIMIT + 99}`)
    expect(kept[0].id).toBe('m100')
  })

  /**
   * Scrolling far enough back has the same ceiling from the other end. Without
   * it, reading history in a long-running channel is unbounded in the
   * direction nobody thinks about.
   */
  it('drops the newest when history is read back past it', () => {
    const store = useMessageStore.getState()
    for (let n = 1000; n < 1000 + SCROLLBACK_LIMIT; n++) {
      store.addMessage('srv', '#chan', message(n))
    }
    store.prependMessages('srv', '#chan', [message(1), message(2), message(3)])

    const kept = useMessageStore.getState().messages['srv:#chan']
    expect(kept).toHaveLength(SCROLLBACK_LIMIT)
    expect(kept[0].id).toBe('m1')
  })

  it('counts each conversation on its own', () => {
    const store = useMessageStore.getState()
    for (let n = 0; n < SCROLLBACK_LIMIT + 10; n++) store.addMessage('srv', '#one', message(n))
    store.addMessage('srv', '#two', message(1))

    expect(useMessageStore.getState().messages['srv:#one']).toHaveLength(SCROLLBACK_LIMIT)
    expect(useMessageStore.getState().messages['srv:#two']).toHaveLength(1)
  })
})
