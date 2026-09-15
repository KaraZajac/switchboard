import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import type { RawLine } from '@shared/types/ipc'
import { Modal } from '../common/Modal'
import { ICON, IconButton } from '../common/IconButton'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'

/**
 * Everything on the wire, for the network you are looking at.
 *
 * The thing you reach for when a network will not behave and the polite
 * messages are not telling you why. Every mainstream client has one; these
 * lines were already being produced here and nothing displayed them.
 *
 * Credentials are masked before a line is ever kept, so what is shown — and
 * what Copy puts on the clipboard — has never held one. See `main/irc/rawlog`.
 */
export function ServerLogModal(): React.JSX.Element | null {
  const closeModal = useUIStore((s) => s.closeModal)
  // The network the menu was opened for, not whichever is active
  const activeServerId = useUIStore((s) => s.serverLogId)
  const server = useServerStore((s) =>
    s.servers.find((entry) => entry.id === useUIStore.getState().serverLogId)
  )

  const [lines, setLines] = useState<RawLine[]>([])
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // What has already happened, then whatever happens while this is open. The
  // buffer is why the log is useful: a connection that failed did so before
  // anybody thought to look at it.
  useEffect(() => {
    if (!activeServerId) return
    let live = true

    void window.switchboard.invoke('raw:log', activeServerId).then((kept) => {
      if (live) setLines(kept)
    })

    const stop = window.switchboard.on('irc:raw-line', ({ serverId, entry }) => {
      if (serverId !== activeServerId) return
      setLines((current) => [...current, entry].slice(-2000))
    })

    return () => {
      live = false
      stop()
    }
  }, [activeServerId])

  // Pinned to the end unless the reader has scrolled away from it
  useLayoutEffect(() => {
    if (!follow) return
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines, follow])

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 40
    setFollow(atEnd)
  }, [])

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(
      lines.map((l) => `${l.at} ${l.direction === 'out' ? '>>' : '<<'} ${l.line}`).join('\n')
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [lines])

  const clear = useCallback(async () => {
    if (!activeServerId) return
    await window.switchboard.invoke('raw:clear', activeServerId)
    setLines([])
  }, [activeServerId])

  if (!activeServerId) return null

  return (
    <Modal title={`Server log — ${server?.name ?? 'network'}`} onClose={closeModal} width="max-w-4xl">
      <div className="flex items-center justify-between gap-2 border-b border-gray-700 px-4 py-2">
        <span className="text-xs text-gray-500">
          {lines.length === 0
            ? 'Nothing yet. Lines appear here as they go out and come back.'
            : `${lines.length} line${lines.length === 1 ? '' : 's'} · passwords are never kept`}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            icon={follow ? ArrowDown : ArrowUp}
            label={follow ? 'Following the end' : 'Jump to the end'}
            active={follow}
            onClick={() => {
              setFollow(true)
              const element = scrollRef.current
              if (element) element.scrollTop = element.scrollHeight
            }}
          />
          <IconButton size="sm" icon={Copy} label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()} />
          <IconButton size="sm" icon={Trash2} label="Clear" danger onClick={() => void clear()} />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[60vh] overflow-y-auto bg-gray-950 px-4 py-2 font-mono text-xs leading-relaxed"
      >
        {lines.map((line, index) => (
          <div key={index} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="shrink-0 text-gray-600">{line.at.slice(11, 19)}</span>
            <span
              className={`shrink-0 ${line.direction === 'out' ? 'text-indigo-400' : 'text-green-400'}`}
              title={line.direction === 'out' ? 'sent' : 'received'}
            >
              {line.direction === 'out' ? '>>' : '<<'}
            </span>
            <span className="text-gray-300">{line.line}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <div className="flex h-full items-center justify-center text-gray-600">
            <ArrowDown size={ICON.sm} strokeWidth={2} className="mr-2" aria-hidden="true" />
            Waiting for traffic
          </div>
        )}
      </div>
    </Modal>
  )
}
